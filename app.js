/* Smart Expense & Payment Tracker (LocalStorage)
 * Beginner-friendly architecture:
 * - Data stored in LocalStorage
 * - Transactions CRUD
 * - Budget control: 80% alert + exceed handling (warn or block)
 * - Dashboard: totals + category summary + simple bar chart
 */

(() => {
  const LS_KEYS = {
    txs: 'sep_tx_v1',
    budget: 'sep_budget_v1',
    wallet: 'sep_wallet_v1',
    seedDone: 'sep_seed_done_v1',
  };


  const CATEGORY_LIST = ['Food', 'Travel', 'Bills', 'Health', 'Education', 'Other'];

  const el = (id) => document.getElementById(id);

  const fmt = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const fmtPlain = (n) => {
    const amount = Number.isFinite(n) ? n : 0;
    try {
      return fmt.format(amount);
    } catch {
      return `INR ${amount.toFixed(2)}`;
    }
  };

  const parseMoney = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const parseDateToLocal = (dateStr) => {
    // dateStr: YYYY-MM-DD. Convert to local midnight timestamp.
    // Avoid timezone shifts by constructing local date.
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  };

  const dateKeyByMode = (mode, timestamp) => {
    // Returns a stable key representing the budget period.
    const dt = new Date(timestamp);
    const y = dt.getFullYear();
    const m = dt.getMonth(); // 0-based
    const d = dt.getDate();

    if (mode === 'daily') return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (mode === 'weekly') {
      // Week key (ISO-ish). We'll use the week starting Monday based on local date.
      const tmp = new Date(timestamp);
      const day = (tmp.getDay() + 6) % 7; // Mon=0..Sun=6
      tmp.setDate(tmp.getDate() - day);
      const yy = tmp.getFullYear();
      const mm = tmp.getMonth() + 1;
      const dd = tmp.getDate();
      return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
    // monthly
    return `${y}-${String(m + 1).padStart(2, '0')}`;
  };

  const getCurrentMonthKey = () => dateKeyByMode('monthly', Date.now());

  function normalizeMonthlySplits(raw) {
    if (!raw || typeof raw !== 'object') return {};

    const monthlySplits = {};
    for (const [month, split] of Object.entries(raw)) {
      if (!/^\d{4}-\d{2}$/.test(month) || !split || typeof split !== 'object') continue;

      const total = Number(split.total || 0);
      const categoryBudgets = {};

      if (split.categoryBudgets && typeof split.categoryBudgets === 'object') {
        for (const c of CATEGORY_LIST) {
          const amount = Number(split.categoryBudgets[c] || 0);
          if (amount > 0) categoryBudgets[c] = amount;
        }
      }

      monthlySplits[month] = {
        month,
        total: Number.isFinite(total) ? total : 0,
        categoryBudgets,
        updatedAt: Number(split.updatedAt || 0) || Date.now(),
      };
    }

    return monthlySplits;
  }

  const storage = {
    getTransactions() {
      const raw = localStorage.getItem(LS_KEYS.txs);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    setTransactions(txs) {
      localStorage.setItem(LS_KEYS.txs, JSON.stringify(txs));
    },

    getWallet() {
      const raw = localStorage.getItem(LS_KEYS.wallet);
      if (!raw) return { balance: 0 };
      try {
        const w = JSON.parse(raw);
        const bal = Number(w?.balance ?? 0);
        return { balance: Number.isFinite(bal) ? bal : 0 };
      } catch {
        return { balance: 0 };
      }
    },
    setWallet(wallet) {
      localStorage.setItem(LS_KEYS.wallet, JSON.stringify({ balance: Number(wallet?.balance ?? 0) }));
    },

    getBudget() {
      const raw = localStorage.getItem(LS_KEYS.budget);
      if (!raw) {
        return {
          mode: 'none',
          total: 0,
          categoryBudgets: {},
          blockOverBudget: false,
          periodResets: {
            lastMonthlyResetKey: null,
          },
          monthlySplits: {},
        };
      }
      try {
        const b = JSON.parse(raw);
        return {
          mode: b.mode ?? 'none',
          total: Number(b.total ?? 0),
          categoryBudgets: b.categoryBudgets && typeof b.categoryBudgets === 'object' ? b.categoryBudgets : {},
          blockOverBudget: Boolean(b.blockOverBudget),
          periodResets: b.periodResets && typeof b.periodResets === 'object' ? b.periodResets : { lastMonthlyResetKey: null },
          monthlySplits: normalizeMonthlySplits(b.monthlySplits),
        };
      } catch {
        return {
          mode: 'none',
          total: 0,
          categoryBudgets: {},
          blockOverBudget: false,
          periodResets: { lastMonthlyResetKey: null },
          monthlySplits: {},
        };
      }
    },
    setBudget(budget) {
      localStorage.setItem(LS_KEYS.budget, JSON.stringify(budget));
    },
    seedDone() {
      return localStorage.getItem(LS_KEYS.seedDone) === '1';
    },
    setSeedDone() {
      localStorage.setItem(LS_KEYS.seedDone, '1');
    },
  };

  const uiAlerts = {
    push(containerId, type, message) {
      const container = el(containerId);
      if (!container) return;
      const div = document.createElement('div');
      div.className = `alert ${type}`;
      div.textContent = message;
      container.appendChild(div);
      // Auto-remove older alerts to keep UI clean
      setTimeout(() => {
        div.remove();
      }, 8000);
    },
    clear(containerId) {
      const container = el(containerId);
      if (container) container.innerHTML = '';
    },
  };

  const state = {
    txs: [],
    budget: null,
    wallet: { balance: 0 },
    editingId: null,
    confirmDraft: null,
    isConfirmOpen: false,
    currentPage: 'dashboard',
  };

  const isSpendingTransaction = (tx) => !tx.status || tx.status === 'success';
  const affectsWallet = (tx) => tx.status === 'success' && tx.walletApplied === true;

  const pageTitles = {
    dashboard: 'Dashboard',
    pay: 'Pay',
    budget: 'Budget',
    transactions: 'Transactions',
  };

  function getPageFromHash() {
    const page = window.location.hash.replace('#', '').trim();
    return pageTitles[page] ? page : 'dashboard';
  }

  function showPage(page = getPageFromHash(), { updateHash = false } = {}) {
    const nextPage = pageTitles[page] ? page : 'dashboard';
    state.currentPage = nextPage;

    document.querySelectorAll('[data-page]').forEach((pageNode) => {
      pageNode.classList.toggle('active', pageNode.dataset.page === nextPage);
    });

    document.querySelectorAll('[data-page-link]').forEach((link) => {
      const isActive = link.dataset.pageLink === nextPage;
      link.classList.toggle('active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });

    document.title = `${pageTitles[nextPage]} - Smart Expense & Payment Tracker`;

    if (updateHash && window.location.hash !== `#${nextPage}`) {
      window.location.hash = nextPage;
    }
  }

  function refreshWalletUI() {
    const walletNode = el('walletBalance');
    if (walletNode) walletNode.textContent = fmtPlain(state.wallet.balance);
  }


  function normalizeBudgetFormToBudget() {
    const mode = el('budgetMode').value;
    const total = parseMoney(el('budgetTotal').value);

    const categoryBudgets = {};
    // Read optional per-category budgets
    for (const c of CATEGORY_LIST) {
      const inputId = `budget${c}`;
      const v = el(inputId);
      if (v && v.value !== '') {
        const n = parseMoney(v.value);
        if (n > 0) categoryBudgets[c] = n;
      }
    }

    const blockOverBudget = Boolean(el('blockOverBudget').checked);

    return {
      mode,
      total,
      categoryBudgets,
      blockOverBudget,
      periodResets: state.budget?.periodResets ?? { lastMonthlyResetKey: null },
      monthlySplits: state.budget?.monthlySplits ?? {},
    };
  }

  function seedSampleIfNeeded() {
    if (storage.seedDone()) return;

    // Seed minimal data so dashboard looks alive.
    const today = new Date();

    const iso = (d) => {
      const dt = new Date(d);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const txs = [
      {
        id: crypto.randomUUID(),
        amount: 350,
        category: 'Food',
        date: iso(today),
        description: 'Breakfast',
        paymentMethod: 'UPI',
        upiId: 'demo@bank',
        txRef: 'sample-food',
        status: 'success',
        walletApplied: false,
        createdAt: Date.now(),
      },
      {
        id: crypto.randomUUID(),
        amount: 120,
        category: 'Bills',
        date: iso(new Date(today.getTime() - 86400000)),
        description: 'Internet recharge',
        paymentMethod: 'Card',
        upiId: '',
        txRef: 'sample-bills',
        status: 'success',
        walletApplied: false,
        createdAt: Date.now(),
      },
      {
        id: crypto.randomUUID(),
        amount: 780,
        category: 'Travel',
        date: iso(today),
        description: 'Commute',
        paymentMethod: 'Cash',
        upiId: '',
        txRef: 'sample-travel',
        status: 'success',
        walletApplied: false,
        createdAt: Date.now(),
      },
    ];

    storage.setTransactions(txs);

    // Seed wallet if empty / first run
    storage.setWallet({ balance: 3000 });

    const seedCategoryBudgets = {
      Food: 1600,
      Travel: 900,
      Bills: 1200,
      Health: 600,
      Education: 400,
    };
    const seedMonth = getCurrentMonthKey();
    const budget = {
      mode: 'monthly',
      total: 5000,
      categoryBudgets: seedCategoryBudgets,
      blockOverBudget: false,
      periodResets: { lastMonthlyResetKey: null },
      monthlySplits: {
        [seedMonth]: {
          month: seedMonth,
          total: 5000,
          categoryBudgets: seedCategoryBudgets,
          updatedAt: Date.now(),
        },
      },
    };
    storage.setBudget(budget);

    storage.setSeedDone();
  }


  function getBudgetPeriodKeyForTransaction(tx) {
    const mode = state.budget?.mode;
    if (!mode || mode === 'none') return null;
    const ts = parseDateToLocal(tx.date);
    return dateKeyByMode(mode, ts);
  }

  function getCurrentPeriodKey() {
    const mode = state.budget?.mode;
    if (!mode || mode === 'none') return null;
    const now = Date.now();
    return dateKeyByMode(mode, now);
  }

  function getBudgetConfigForPeriod(mode, periodKey) {
    const base = {
      total: Number(state.budget?.total || 0),
      categoryBudgets: state.budget?.categoryBudgets || {},
      source: 'manual',
    };

    if (mode === 'monthly' && periodKey) {
      const split = state.budget?.monthlySplits?.[periodKey];
      if (split) {
        return {
          total: Number(split.total || 0),
          categoryBudgets: split.categoryBudgets || {},
          source: 'monthlySplit',
        };
      }
    }

    return base;
  }

  function filterTransactionsForCurrentPeriod(txs) {
    const mode = state.budget?.mode;
    const periodKey = getCurrentPeriodKey();
    if (!mode || mode === 'none' || !periodKey) return txs;

    return txs.filter((t) => getBudgetPeriodKeyForTransaction(t) === periodKey);
  }

  function monthResetIfNeeded() {
    if (state.budget?.mode !== 'monthly') return;

    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const last = state.budget?.periodResets?.lastMonthlyResetKey;
    if (last && last === key) return;

    // Reset meaning: for monthly mode, we keep transactions, but dashboard only shows current month.
    // Still, we maintain a reset marker for clarity.
    state.budget.periodResets = state.budget.periodResets ?? { lastMonthlyResetKey: null };
    state.budget.periodResets.lastMonthlyResetKey = key;
    storage.setBudget(state.budget);
  }

  function computeDashboard() {
    const txs = state.txs;
    const mode = state.budget?.mode;

    const onlyThisPeriod = el('showOnlyThisPeriod')?.checked ?? true;
    const periodKey = onlyThisPeriod ? getCurrentPeriodKey() : null;
    const scoped = onlyThisPeriod ? filterTransactionsForCurrentPeriod(txs) : txs;
    const spendingTxs = scoped.filter(isSpendingTransaction);
    const budgetConfig = getBudgetConfigForPeriod(mode, periodKey);

    const totalSpent = spendingTxs.reduce((sum, t) => sum + Number(t.amount || 0), 0);

    let remaining = 0;
    let usagePercent = 0;

    const budgetTotal = mode && mode !== 'none' ? Number(budgetConfig.total || 0) : 0;
    if (budgetTotal > 0) {
      remaining = budgetTotal - totalSpent;
      usagePercent = totalSpent / budgetTotal;
    } else {
      remaining = 0;
      usagePercent = 0;
    }

    // Category summary
    const categorySpent = {};
    for (const c of CATEGORY_LIST) categorySpent[c] = 0;
    for (const t of spendingTxs) {
      const c = t.category || 'Other';
      categorySpent[c] = (categorySpent[c] || 0) + Number(t.amount || 0);
    }

    return {
      totalSpent,
      remaining,
      usagePercent,
      budgetTotal,
      categoryBudgets: budgetConfig.categoryBudgets,
      budgetSource: budgetConfig.source,
      budgetPeriod: periodKey,
      categorySpent,
    };
  }

  function updateCategorySummaryTable(summary) {
    const tbody = el('categorySummaryTable')?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const budgetCats = summary.categoryBudgets || {};

    for (const c of CATEGORY_LIST) {
      const spent = summary.categorySpent[c] || 0;
      const catBudget = budgetCats[c] ? Number(budgetCats[c]) : 0;
      const catRemaining = catBudget > 0 ? catBudget - spent : 0;

      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.textContent = c;
      const td2 = document.createElement('td');
      td2.textContent = fmtPlain(spent);
      const td3 = document.createElement('td');
      td3.textContent = catBudget > 0 ? fmtPlain(catBudget) : '-';
      const td4 = document.createElement('td');
      td4.textContent = catBudget > 0 ? fmtPlain(catRemaining) : '-';

      tr.append(td1, td2, td3, td4);
      tbody.appendChild(tr);
    }
  }

  function drawCategoryChart(summary) {
    const canvas = el('categoryChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const labels = CATEGORY_LIST;
    const values = labels.map((c) => summary.categorySpent[c] || 0);
    const max = Math.max(1, ...values);

    const padding = 28;
    const chartW = w - padding * 2;
    const chartH = h - padding * 2;

    // axes
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, padding + chartH);
    ctx.lineTo(padding + chartW, padding + chartH);
    ctx.stroke();

    // bars
    const barGap = 10;
    const barW = (chartW - barGap * (labels.length - 1)) / labels.length;

    labels.forEach((label, i) => {
      const v = values[i];
      const barH = (v / max) * (chartH - 18);
      const x = padding + i * (barW + barGap);
      const y = padding + chartH - barH;

      const hue = (i * 52) % 360;
      ctx.fillStyle = `hsla(${hue}, 90%, 65%, .55)`;
      ctx.fillRect(x, y, barW, barH);

      ctx.fillStyle = 'rgba(255,255,255,.82)';
      ctx.font = '12px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
      ctx.textAlign = 'center';
      ctx.fillText(label, x + barW / 2, padding + chartH + 18);

      // value label
      ctx.fillStyle = 'rgba(255,255,255,.72)';
      ctx.font = '12px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
      ctx.fillText(v > 0 ? fmtPlain(v) : '', x + barW / 2, y - 6);
    });
  }

  function updateDashboardUI() {
    monthResetIfNeeded();

    const summary = computeDashboard();

    el('totalSpending').textContent = fmtPlain(summary.totalSpent);

    if (state.budget?.mode && state.budget.mode !== 'none' && summary.budgetTotal > 0) {
      el('remainingBudget').textContent = fmtPlain(summary.remaining);
      el('usagePercent').textContent = `${Math.round(summary.usagePercent * 100)}%`;

      // 80% alert
      if (summary.usagePercent >= 0.8 && summary.usagePercent < 1) {
        // keep this non-spammy: only show when flag not set
        const alertKey = `sep_budget80_alert_${state.budget.mode}`;
        const k = getCurrentPeriodKey();
        const composed = alertKey + '_' + k;
        const already = localStorage.getItem(composed) === '1';
        if (!already) {
          localStorage.setItem(composed, '1');
          uiAlerts.push('budgetAlerts', 'warn', `Alert: You reached ${Math.round(summary.usagePercent * 100)}% of your budget (${fmtPlain(summary.totalSpent)} spent).`);
        }
      }
    } else {
      el('remainingBudget').textContent = '-';
      el('usagePercent').textContent = '-';
    }

    updateCategorySummaryTable(summary);
    drawCategoryChart(summary);
  }

  function renderTransactionsTable(txs) {
    const tbody = el('txTable')?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    for (const t of txs) {
      const tr = document.createElement('tr');
      if (t.status === 'blocked') tr.className = 'tx-blocked';

      const tdDate = document.createElement('td');
      tdDate.textContent = t.date;

      const tdAmt = document.createElement('td');
      tdAmt.textContent = fmtPlain(Number(t.amount || 0));

      const tdCat = document.createElement('td');
      tdCat.textContent = t.category || 'Other';

      const tdDesc = document.createElement('td');
      tdDesc.textContent = t.description || '-';

      const tdPay = document.createElement('td');
      tdPay.textContent = t.paymentMethod || '-';
      const paymentMeta = [t.upiId ? `UPI: ${t.upiId}` : '', t.txRef ? `Ref: ${t.txRef}` : '']
        .filter(Boolean)
        .join(' | ');
      if (paymentMeta) {
        const meta = document.createElement('div');
        meta.className = 'tx-meta';
        meta.textContent = paymentMeta;
        tdPay.appendChild(meta);
      }

      const tdStatus = document.createElement('td');
      const status = t.status === 'blocked' ? 'blocked' : 'success';
      const statusBadge = document.createElement('span');
      statusBadge.className = `status-badge ${status}`;
      statusBadge.textContent = status === 'blocked' ? 'Blocked' : 'Success';
      if (status === 'blocked' && t.blockReason) statusBadge.title = t.blockReason;
      tdStatus.appendChild(statusBadge);

      const tdActions = document.createElement('td');
      const wrap = document.createElement('div');
      wrap.className = 'tx-actions';

      if (isSpendingTransaction(t)) {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'icon-btn';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => startEdit(t.id));
        wrap.appendChild(editBtn);
      }

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'icon-btn danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deleteTransaction(t.id));

      wrap.appendChild(delBtn);
      tdActions.appendChild(wrap);

      tr.append(tdDate, tdAmt, tdCat, tdDesc, tdPay, tdStatus, tdActions);
      tbody.appendChild(tr);
    }
  }

  function refreshAll() {
    state.txs = storage.getTransactions();
    state.budget = storage.getBudget();
    state.wallet = storage.getWallet();
    refreshWalletUI();

    // Decide what rows to show
    const onlyThisPeriod = el('showOnlyThisPeriod')?.checked ?? true;
    const shown = onlyThisPeriod ? filterTransactionsForCurrentPeriod(state.txs) : state.txs;

    // sort by date desc
    shown.sort((a, b) => parseDateToLocal(b.date) - parseDateToLocal(a.date));

    renderTransactionsTable(shown);
    updateDashboardUI();
    updateSplitSummary();
  }

  function startEdit(id) {
    const tx = state.txs.find((t) => t.id === id);
    if (!tx) return;
    if (!isSpendingTransaction(tx)) {
      uiAlerts.push('txAlerts', 'warn', 'Blocked payment attempts cannot be edited. Delete the attempt or create a new payment.');
      return;
    }

    showPage('pay', { updateHash: true });
    closeConfirmUI();
    state.editingId = id;

    el('amount').value = tx.amount;
    el('category').value = tx.category;
    el('date').value = tx.date;
    el('paymentMethod').value = tx.paymentMethod;
    el('upiId').value = tx.upiId || '';
    el('txRef').value = tx.txRef || '';
    el('description').value = tx.description || '';

    // UI tweak: change button label
    const submitBtn = el('txForm')?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Update Payment';

    uiAlerts.clear('txAlerts');
    uiAlerts.push('txAlerts', 'good', 'Editing mode: update the form and submit to save changes.');
  }

  function clearEditMode() {
    state.editingId = null;
    el('txForm')?.reset();

    const submitBtn = el('txForm')?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Pay Now';

    uiAlerts.clear('txAlerts');
  }

  function deleteTransaction(id) {
    const tx = state.txs.find((t) => t.id === id);
    const remaining = state.txs.filter((t) => t.id !== id);

    if (tx && affectsWallet(tx)) {
      state.wallet.balance += Number(tx.amount || 0);
      storage.setWallet(state.wallet);
    }

    storage.setTransactions(remaining);
    if (state.editingId === id) clearEditMode();
    refreshAll();
    uiAlerts.push('txAlerts', 'good', tx && affectsWallet(tx) ? 'Payment deleted and wallet balance restored.' : 'Transaction deleted.');
  }

  function computeSpentInPeriodForMode(txs, budgetMode, periodKey) {
    if (!budgetMode || budgetMode === 'none') return 0;
    return txs
      .filter(isSpendingTransaction)
      .filter((t) => dateKeyByMode(budgetMode, parseDateToLocal(t.date)) === periodKey)
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
  }

  function validateBudgetControlForNewTx(newTx, { editingId = null } = {}) {
    const b = state.budget;
    if (!b || !b.mode || b.mode === 'none') {
      return { ok: true };
    }

    const periodKey = getBudgetPeriodKeyForTransaction(newTx);
    const txsWithoutEdited = editingId ? state.txs.filter((t) => t.id !== editingId) : state.txs;
    const budgetConfig = getBudgetConfigForPeriod(b.mode, periodKey);

    const spentBefore = computeSpentInPeriodForMode(txsWithoutEdited, b.mode, periodKey);
    const budgetTotal = Number(budgetConfig.total || 0);

    if (budgetTotal <= 0) return { ok: true };

    const remainingBefore = budgetTotal - spentBefore;
    const willRemain = remainingBefore - Number(newTx.amount || 0);

    if (willRemain < 0) {
      const overBy = Math.abs(willRemain);
      const msg = `Warning: This transaction exceeds your ${b.mode} budget by ${fmtPlain(overBy)}.`;
      if (b.blockOverBudget) {
        uiAlerts.push('budgetAlerts', 'danger', msg);
        return { ok: false, message: msg };
      }
      uiAlerts.push('budgetAlerts', 'warn', msg);
      return { ok: true, message: msg };
    }

    const categoryBudget = Number(budgetConfig.categoryBudgets?.[newTx.category] || 0);
    if (categoryBudget > 0) {
      const categorySpentBefore = txsWithoutEdited
        .filter(isSpendingTransaction)
        .filter((t) => t.category === newTx.category)
        .filter((t) => dateKeyByMode(b.mode, parseDateToLocal(t.date)) === periodKey)
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const categoryWillRemain = categoryBudget - categorySpentBefore - Number(newTx.amount || 0);

      if (categoryWillRemain < 0) {
        const overBy = Math.abs(categoryWillRemain);
        const msg = `Warning: This ${newTx.category} payment exceeds its ${b.mode} category split by ${fmtPlain(overBy)}.`;
        if (b.blockOverBudget) {
          uiAlerts.push('budgetAlerts', 'danger', msg);
          return { ok: false, message: msg };
        }
        uiAlerts.push('budgetAlerts', 'warn', msg);
        return { ok: true, message: msg };
      }
    }

    return { ok: true };
  }

  function handleBudgetSubmit(e) {
    e.preventDefault();
    const b = normalizeBudgetFormToBudget();

    if (b.mode === 'monthly' && b.total > 0) {
      const currentMonth = getCurrentMonthKey();
      b.monthlySplits = {
        ...(b.monthlySplits || {}),
        [currentMonth]: {
          month: currentMonth,
          total: b.total,
          categoryBudgets: b.categoryBudgets,
          updatedAt: Date.now(),
        },
      };
    }

    // Save
    state.budget = b;
    storage.setBudget(b);

    uiAlerts.clear('budgetAlerts');
    uiAlerts.push('budgetAlerts', 'good', 'Budget saved. Dashboard updated.');

    refreshAll();
    loadSplitFormFromBudget();
  }

  function resetMonthlyBtn() {
    // Optional advanced feature: monthly reset of budget period marker.
    // We keep transactions (history) but marker + dashboard period logic updates.
    if (state.budget?.mode !== 'monthly') {
      uiAlerts.push('budgetAlerts', 'warn', 'Monthly reset is only active when budget mode is Monthly.');
      return;
    }
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    state.budget.periodResets = state.budget.periodResets ?? { lastMonthlyResetKey: null };
    state.budget.periodResets.lastMonthlyResetKey = key;
    storage.setBudget(state.budget);

    // Clear 80% alert marker for this period.
    const alertKey = `sep_budget80_alert_${state.budget.mode}_${key}`;
    localStorage.setItem(alertKey, '0');

    uiAlerts.push('budgetAlerts', 'good', 'Monthly reset done (dashboard recalculated for the current month).');
    refreshAll();
  }

  function clearAllData() {
    const ok = confirm('Clear all transactions, wallet, and budget data?');
    if (!ok) return;
    localStorage.removeItem(LS_KEYS.txs);
    localStorage.removeItem(LS_KEYS.budget);
    localStorage.removeItem(LS_KEYS.wallet);
    storage.setSeedDone();
    clearEditMode();
    closeConfirmUI();

    refreshAll();
    loadBudgetFormFromStorage();
    loadSplitFormFromBudget();
    uiAlerts.push('txAlerts', 'good', 'All data cleared.');
  }

  function loadBudgetFormFromStorage() {
    const b = state.budget;
    el('budgetMode').value = b.mode || 'none';
    el('budgetTotal').value = b.total ?? '';
    el('blockOverBudget').checked = Boolean(b.blockOverBudget);

    // Category inputs
    for (const c of CATEGORY_LIST) {
      const inputId = `budget${c}`;
      const v = b.categoryBudgets?.[c];
      el(inputId).value = v ? String(v) : '';
    }
  }

  function sumCategoryAmounts(categoryBudgets) {
    return CATEGORY_LIST.reduce((sum, c) => sum + Number(categoryBudgets?.[c] || 0), 0);
  }

  function readCategoryAmountInputs(prefix) {
    const categoryBudgets = {};
    for (const c of CATEGORY_LIST) {
      const input = el(`${prefix}${c}`);
      if (!input || input.value === '') continue;

      const amount = parseMoney(input.value);
      if (amount > 0) categoryBudgets[c] = amount;
    }
    return categoryBudgets;
  }

  function writeCategoryAmountInputs(prefix, categoryBudgets = {}) {
    for (const c of CATEGORY_LIST) {
      const input = el(`${prefix}${c}`);
      if (input) input.value = categoryBudgets[c] ? String(categoryBudgets[c]) : '';
    }
  }

  function getSplitFormData() {
    const month = el('splitMonth')?.value || getCurrentMonthKey();
    const total = parseMoney(el('splitAccountAmount')?.value);
    const categoryBudgets = readCategoryAmountInputs('split');
    const allocated = sumCategoryAmounts(categoryBudgets);

    return {
      month,
      total,
      categoryBudgets,
      allocated,
      remaining: total - allocated,
    };
  }

  function updateSplitSummary() {
    if (!el('splitAllocatedTotal')) return;

    const split = getSplitFormData();
    const saved = state.budget?.monthlySplits?.[split.month];

    el('splitAllocatedTotal').textContent = fmtPlain(split.allocated);
    el('splitRemaining').textContent = fmtPlain(split.remaining);
    el('splitRemaining').classList.toggle('negative', split.remaining < 0);
    el('splitMonthStatus').textContent = saved ? 'Saved' : 'Not saved';
  }

  function loadSplitFormFromBudget(monthKey = getCurrentMonthKey()) {
    if (!el('splitMonth')) return;

    const split = state.budget?.monthlySplits?.[monthKey];
    const useCurrentBudgetFallback = monthKey === getCurrentMonthKey() && state.budget?.mode === 'monthly';
    const source = split || (useCurrentBudgetFallback
      ? { total: Number(state.budget.total || 0), categoryBudgets: state.budget.categoryBudgets || {} }
      : null);

    el('splitMonth').value = monthKey;
    el('splitAccountAmount').value = source?.total ? String(source.total) : '';
    writeCategoryAmountInputs('split', source?.categoryBudgets || {});
    updateSplitSummary();
  }

  function handleMonthlySplitSubmit(e) {
    e.preventDefault();

    const split = getSplitFormData();
    if (!split.month) {
      uiAlerts.push('splitAlerts', 'warn', 'Choose a month for this category split.');
      return;
    }
    if (split.total <= 0) {
      uiAlerts.push('splitAlerts', 'warn', 'Enter an account amount greater than 0.');
      return;
    }
    if (split.allocated <= 0) {
      uiAlerts.push('splitAlerts', 'warn', 'Split at least one category amount.');
      return;
    }
    if (split.allocated > split.total) {
      uiAlerts.push('splitAlerts', 'danger', `Your category split is over the account amount by ${fmtPlain(Math.abs(split.remaining))}.`);
      return;
    }

    const monthlySplits = {
      ...(state.budget?.monthlySplits || {}),
      [split.month]: {
        month: split.month,
        total: split.total,
        categoryBudgets: split.categoryBudgets,
        updatedAt: Date.now(),
      },
    };
    const currentMonthSplit = monthlySplits[getCurrentMonthKey()];
    const activeSplit = currentMonthSplit || monthlySplits[split.month];

    state.budget = {
      ...(state.budget || storage.getBudget()),
      mode: 'monthly',
      total: Number(activeSplit.total || 0),
      categoryBudgets: activeSplit.categoryBudgets || {},
      monthlySplits,
      periodResets: state.budget?.periodResets ?? { lastMonthlyResetKey: null },
      blockOverBudget: Boolean(state.budget?.blockOverBudget),
    };

    storage.setBudget(state.budget);
    loadBudgetFormFromStorage();
    loadSplitFormFromBudget(split.month);
    refreshAll();
    uiAlerts.push('splitAlerts', 'good', `Monthly split saved for ${split.month}.`);
  }

  function getFormTx() {
    return {
      amount: parseMoney(el('amount').value),
      category: el('category').value,
      date: el('date').value,
      description: el('description').value.trim(),
      paymentMethod: el('paymentMethod').value,
      upiId: el('upiId').value.trim(),
      txRef: el('txRef').value.trim(),
    };
  }

  function updateEditedPayment(formTx, editingId) {
    const existing = state.txs.find((t) => t.id === editingId);
    if (!existing) {
      clearEditMode();
      uiAlerts.push('txAlerts', 'warn', 'The payment you were editing no longer exists.');
      return;
    }

    const updatedTx = {
      ...existing,
      amount: formTx.amount,
      category: formTx.category,
      date: formTx.date,
      description: formTx.description || '',
      paymentMethod: formTx.paymentMethod,
      upiId: formTx.upiId || '',
      txRef: formTx.txRef || '',
      status: existing.status || 'success',
      updatedAt: Date.now(),
    };

    const validation = validateBudgetControlForNewTx(updatedTx, { editingId });
    if (!validation.ok) {
      uiAlerts.push('txAlerts', 'danger', validation.message || 'Payment update blocked due to budget.');
      return;
    }

    if (affectsWallet(existing)) {
      const oldAmount = Number(existing.amount || 0);
      const newAmount = Number(updatedTx.amount || 0);
      const delta = newAmount - oldAmount;

      if (delta > 0 && state.wallet.balance < delta) {
        uiAlerts.push('txAlerts', 'danger', `Payment update blocked: wallet needs ${fmtPlain(delta)} more.`);
        return;
      }

      if (delta !== 0) {
        state.wallet.balance -= delta;
        storage.setWallet(state.wallet);
      }
    }

    state.txs = state.txs.map((t) => (t.id === editingId ? updatedTx : t));
    storage.setTransactions(state.txs);
    clearEditMode();
    refreshAll();
    uiAlerts.push('txAlerts', 'good', 'Payment updated. Budget and wallet are synced.');
  }

  function submitTx(e) {
    e.preventDefault();

    const formTx = getFormTx();
    if (!formTx.date) {
      uiAlerts.push('txAlerts', 'warn', 'Please provide a date.');
      return;
    }
    if (formTx.amount <= 0) {
      uiAlerts.push('txAlerts', 'warn', 'Amount must be greater than 0.');
      return;
    }

    const editingId = state.editingId;
    if (editingId) {
      updateEditedPayment(formTx, editingId);
      return;
    }

    state.confirmDraft = {
      amount: formTx.amount,
      category: formTx.category,
      date: formTx.date,
      description: formTx.description || '',
      paymentMethod: formTx.paymentMethod,
      upiId: formTx.upiId || '',
      txRef: formTx.txRef || '',
    };

    openConfirmUIForDraft();
    uiAlerts.push('txAlerts', 'good', 'Review the payment summary, then press Confirm.');
  }

  function exportCsv() {
    const onlyThisPeriod = el('showOnlyThisPeriod')?.checked ?? true;
    const txs = onlyThisPeriod ? filterTransactionsForCurrentPeriod(state.txs) : state.txs;

    const header = ['Date', 'Amount', 'Category', 'Description', 'PaymentMethod', 'UPIId', 'Reference', 'Status', 'BlockReason'];
    const rows = txs
      .slice()
      .sort((a, b) => parseDateToLocal(b.date) - parseDateToLocal(a.date))
      .map((t) => [
        t.date,
        t.amount,
        t.category,
        t.description || '',
        t.paymentMethod || '',
        t.upiId || '',
        t.txRef || '',
        t.status || 'success',
        t.blockReason || '',
      ].map(csvEscape).join(','));

    const csv = [header.join(','), ...rows].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart-expense-export-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    uiAlerts.push('txAlerts', 'good', 'CSV exported.');
  }

  function csvEscape(v) {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function validateBudgetControlAtConfirm(newTx, { editingId = null } = {}) {
    // Confirm-time budget control: matches existing blockOverBudget semantics.
    // Returns { ok:boolean, message?:string }.
    return validateBudgetControlForNewTx(newTx, { editingId });
  }

  function openConfirmUIForDraft() {
    state.isConfirmOpen = true;
    el('confirmPaymentBtn').disabled = false;
    el('cancelConfirmBtn').disabled = false;

    el('confirmAmount').textContent = fmtPlain(state.confirmDraft.amount);
    el('confirmCategory').textContent = state.confirmDraft.category || 'Other';
    el('confirmDate').textContent = state.confirmDraft.date;
    el('confirmMethod').textContent = state.confirmDraft.paymentMethod || '-';

    const walletAfter = state.wallet.balance - Number(state.confirmDraft.amount || 0);
    el('confirmWalletAfter').textContent = fmtPlain(walletAfter);

    const b = state.budget;
    const mode = b?.mode;
    const periodKey = getBudgetPeriodKeyForTransaction(state.confirmDraft);
    const budgetConfig = getBudgetConfigForPeriod(mode, periodKey);
    const budgetTotal = mode && mode !== 'none' ? Number(budgetConfig.total || 0) : 0;

    if (budgetTotal > 0) {
      const totalInPeriod = computeSpentInPeriodForMode(state.txs, b.mode, periodKey);
      const remaining = budgetTotal - totalInPeriod;
      const after = remaining - Number(state.confirmDraft.amount || 0);
      const splitLabel = budgetConfig.source === 'monthlySplit' ? `, ${periodKey} split` : '';
      el('confirmBudgetPreview').textContent = `Budget preview (${mode}${splitLabel}): ${fmtPlain(remaining)} before, ${fmtPlain(after)} after.`;
    } else {
      el('confirmBudgetPreview').textContent = 'Budget is OFF (no budget control).';
    }

    if (walletAfter < 0) {
      el('paymentStatus').innerHTML = `<div class="alert warn">Wallet is short by ${fmtPlain(Math.abs(walletAfter))}. Confirm will block this payment.</div>`;
    } else {
      el('paymentStatus').innerHTML = '';
    }

    uiAlerts.clear('txAlerts');
  }

  function closeConfirmUI({ keepStatus = false } = {}) {
    state.isConfirmOpen = false;
    state.confirmDraft = null;

    el('confirmPaymentBtn').disabled = true;
    el('cancelConfirmBtn').disabled = true;

    // Clear confirm text
    el('confirmAmount').textContent = '-';
    el('confirmCategory').textContent = '-';
    el('confirmDate').textContent = '-';
    el('confirmMethod').textContent = '-';
    el('confirmWalletAfter').textContent = '-';
    el('confirmBudgetPreview').textContent = '';
    if (!keepStatus) el('paymentStatus').innerHTML = '';
  }

  function getConfirmWalletSufficiency() {
    const amt = Number(state.confirmDraft?.amount || 0);
    return state.wallet.balance >= amt;
  }

  function createSuccessfulTransactionFromDraft() {
    const newTx = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      amount: Number(state.confirmDraft.amount || 0),
      category: state.confirmDraft.category,
      date: state.confirmDraft.date,
      description: state.confirmDraft.description || '',
      paymentMethod: state.confirmDraft.paymentMethod,
      upiId: state.confirmDraft.upiId || '',
      txRef: state.confirmDraft.txRef || '',
      status: 'success',
      walletApplied: true,
    };

    state.txs.push(newTx);
    storage.setTransactions(state.txs);
    return newTx;
  }

  function createBlockedTransactionFromDraft(reason) {
    // For transparency in the transactions table, we record blocked attempts.
    // BUT dashboard totals must ignore them.
    const blockedTx = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      amount: Number(state.confirmDraft.amount || 0),
      category: state.confirmDraft.category,
      date: state.confirmDraft.date,
      description: state.confirmDraft.description || '',
      paymentMethod: state.confirmDraft.paymentMethod,
      upiId: state.confirmDraft.upiId || '',
      txRef: state.confirmDraft.txRef || '',
      status: 'blocked',
      walletApplied: false,
      blockReason: reason || 'Blocked by rules',
    };
    state.txs.push(blockedTx);
    storage.setTransactions(state.txs);
    return blockedTx;
  }

  function handleConfirmPayment() {
    if (!state.isConfirmOpen || !state.confirmDraft) return;

    const amt = Number(state.confirmDraft.amount || 0);
    if (!Number.isFinite(amt) || amt <= 0) {
      uiAlerts.push('paymentStatus', 'warn', 'Invalid amount.');
      return;
    }

    // Check wallet first
    const walletOk = getConfirmWalletSufficiency();

    if (!walletOk) {
      const msg = `Payment blocked: wallet balance (${fmtPlain(state.wallet.balance)}) is less than amount (${fmtPlain(amt)}).`;
      createBlockedTransactionFromDraft(msg);
      refreshAll();
      closeConfirmUI({ keepStatus: true });
      el('paymentStatus').innerHTML = `<div class="alert danger">${msg}</div>`;
      return;
    }

    // Check budget at confirm-time
    const bValidation = validateBudgetControlAtConfirm(state.confirmDraft, { editingId: null });

    // Budget validation returns ok:false only when blockOverBudget enabled
    if (!bValidation.ok) {
      const msg = bValidation.message || 'Payment blocked due to budget rules.';
      createBlockedTransactionFromDraft(msg);
      refreshAll();
      closeConfirmUI({ keepStatus: true });
      el('paymentStatus').innerHTML = `<div class="alert danger">${msg}</div>`;
      return;
    }

    // If we got here, confirm success
    state.wallet.balance -= amt;
    storage.setWallet(state.wallet);

    createSuccessfulTransactionFromDraft();

    const msg = `Payment successful: ${fmtPlain(amt)} deducted from wallet.`;
    clearEditMode();
    refreshAll();
    closeConfirmUI({ keepStatus: true });
    el('paymentStatus').innerHTML = `<div class="alert good">${msg}</div>`;
  }

  function init() {
    // Ensure sample data + load
    seedSampleIfNeeded();

    window.addEventListener('hashchange', () => showPage());
    showPage(getPageFromHash());

    state.budget = storage.getBudget();
    state.txs = storage.getTransactions();
    state.wallet = storage.getWallet();

    // Load budget form from storage
    loadBudgetFormFromStorage();
    loadSplitFormFromBudget();

    // Budget form events
    el('budgetForm').addEventListener('submit', handleBudgetSubmit);
    el('splitForm').addEventListener('submit', handleMonthlySplitSubmit);
    el('splitMonth').addEventListener('change', () => loadSplitFormFromBudget(el('splitMonth').value || getCurrentMonthKey()));
    el('splitAccountAmount').addEventListener('input', updateSplitSummary);
    for (const c of CATEGORY_LIST) {
      el(`split${c}`).addEventListener('input', updateSplitSummary);
    }
    el('useWalletForSplitBtn').addEventListener('click', () => {
      el('splitAccountAmount').value = String(state.wallet.balance || 0);
      updateSplitSummary();
    });
    el('resetMonthlyBtn').addEventListener('click', resetMonthlyBtn);
    el('clearAllBtn').addEventListener('click', clearAllData);

    // Tx payment flow form events (Pay Now)
    el('txForm').addEventListener('submit', submitTx);

    // Confirm / cancel events
    el('confirmPaymentBtn').addEventListener('click', handleConfirmPayment);
    el('cancelConfirmBtn').addEventListener('click', closeConfirmUI);

    // Wallet top up
    el('walletTopUpBtn').addEventListener('click', () => {
      const v = parseMoney(el('walletTopUp').value);
      if (!Number.isFinite(v) || v <= 0) {
        uiAlerts.push('txAlerts', 'warn', 'Enter a valid top up amount.');
        return;
      }
      state.wallet.balance += v;
      storage.setWallet(state.wallet);
      refreshWalletUI();
      el('walletTopUp').value = '';
      uiAlerts.push('txAlerts', 'good', `Wallet topped up by ${fmtPlain(v)}.`);
    });

    // Export
    el('exportCsvBtn').addEventListener('click', exportCsv);

    // Toggle period view
    el('showOnlyThisPeriod').addEventListener('change', refreshAll);

    // Budget seed checkbox: if user chooses to seed sample, do it once.
    el('seedSample').addEventListener('change', () => {
      // Seeding happens on first run only.
    });

    // Set wallet UI
    refreshWalletUI();

    // Disable confirm by default
    el('confirmPaymentBtn').disabled = true;
    el('cancelConfirmBtn').disabled = true;

    refreshAll();
  }


  init();
})();

