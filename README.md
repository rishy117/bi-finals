# Kristwin Consumer Goods Trading — BI System

Sales, Inventory, and Procurement Monitoring system with a Business Intelligence dashboard,
based on the BI dashboard prototype in the BSIS 4-A project paper.

**Stack:** HTML · CSS · JavaScript (frontend) · PHP 8 (backend API) · MySQL / MariaDB (database) — runs on XAMPP.

## How to run (XAMPP)

1. Put this folder inside `C:\xampp\htdocs\` and name it `kristwin`
   (on the development laptop this is already linked: `C:\xampp\htdocs\kristwin` → this folder).
2. Open the **XAMPP Control Panel** and click **Start** for **Apache** and **MySQL**.
3. Create the database — either:
   - open <http://localhost/kristwin/install.php> and click **Install database**, or
   - in phpMyAdmin (<http://localhost/phpmyadmin>) → **Import** → choose `database/kristwin_db.sql` → **Go**.
4. Open <http://localhost/kristwin/>

| Username | Password | Role |
|---|---|---|
| admin | admin123 | Administrator (owner) — full access, can delete records and manage users |
| staff | staff123 | Staff — can record sales, products, suppliers and purchase orders |

To reset everything to the sample data, open `install.php`, type `RESET`, and click **Reset database**.
Database settings (host, user, password, database name) are in `config.php`.

## Database (`kristwin_db`)

| Table | Contents |
|---|---|
| `users` | System accounts (bcrypt password hashes), role `admin` / `staff` |
| `products` | Product code, name, category, unit, selling price, current stock, reorder level |
| `suppliers` | Supplier name and contact details |
| `sales` | One row per sales transaction → `product_id` references `products` |
| `purchase_orders` | PO number, supplier, date, status (Pending / In Progress / Delivered / Cancelled) |
| `purchase_order_items` | Products, quantities and unit costs of each purchase order |

Foreign keys protect the data: products with sales or purchase records, and suppliers with
purchase orders, cannot be deleted. Recording a sale and delivering a purchase order both run
in a database transaction, so stock is always updated together with the record.

## Modules

| Module | What it does |
|---|---|
| **Dashboard** | KPI cards (total, average, highest and lowest month), monthly sales bar chart with peak months, sales-by-product donut, Inventory Status, Procurement Summary and Low-Performing Products. Year selector and Print. |
| **Sales** | Record sales (date, product, qty, price, discount, customer, In-store/Messenger). Stock is deducted automatically; admins can void a sale, which returns the stock. Filters and CSV export. |
| **Inventory** | Product list. Status is automatic: *In Stock*, *Reorder Soon* (within 10% of reorder level), *Low Stock* (below reorder level), *Out of Stock*. |
| **Procurement** | Purchase orders with line items. Pending → In Progress → Delivered (or Cancelled). Marking *Delivered* adds the quantities to stock. |
| **Suppliers** | Central supplier contact list (replaces scattered Messenger threads). |
| **Users** | Admin-only account management. |

## Dashboard rules

- **Peak months** = the two highest-selling months of the selected year.
- **Sales by Product** = top 5 products; the rest are grouped as *Other Products*.
- **Low-Performing Products** = the 4 lowest-selling products. *Low Demand* if fewer than 500 units
  sold in the year (prorated for the current year), otherwise *Slow Moving*.
- **Procurement Summary** = the 5 most recent purchase orders.

The 2025 sample data (543 sales transactions) reproduces the figures in the paper exactly:
total ₱2,389,970, average ₱199,164, highest December ₱289,430, lowest February ₱128,420.
The figures are simulated estimates.

## Files

```
index.html               Web interface (single page)
assets/css/style.css     Styles
assets/js/app.js         Pages, forms and tables
assets/js/charts.js      Bar and donut charts (SVG, works offline)
api.php                  JSON API router  (e.g. api.php/products, api.php/dashboard?year=2025)
config.php               Database connection settings
install.php              One-click database setup / reset
includes/bootstrap.php   Database connection, validation, login session, shared helpers
modules/*.php            API endpoints per module (auth, dashboard, products, sales, suppliers, purchases, users)
database/kristwin_db.sql Database schema + sample data
```
