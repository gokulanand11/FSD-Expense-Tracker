# Smart Expense & Payment Tracker (LocalStorage)

Beginner-to-intermediate single-page web app (HTML/CSS/JS).

## Run
- Open `index.html` in a browser.

## Features
- Page-based navigation for Dashboard, Pay, Budget, and Transactions
- Simulated wallet balance with top up, Pay Now, and Confirm Payment flow
- Successful payments become budget-tracked expenses
- Blocked payments are recorded in history but ignored by spending totals
- Add/edit/delete simulated transactions (no real payments)
- Optional budget: daily / weekly / monthly
- Category-based budget (Food/Travel/Bills/...) 
- Monthly account split: manually divide an account amount into category budgets
- Real-time remaining budget + 80% reached alert
- If payment exceeds budget: warning + optional block at confirm time
- Dashboard: total spending, remaining budget, category-wise summary
- Simple bar chart by category
- Data persists via LocalStorage

## Storage
- Transactions stored in LocalStorage as JSON.
- Budget settings stored in LocalStorage as JSON.
- Wallet balance stored in LocalStorage as JSON.


