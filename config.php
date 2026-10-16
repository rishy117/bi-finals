<?php
// Database connection settings (XAMPP defaults: user "root", no password).
define('DB_HOST', '127.0.0.1');
define('DB_PORT', 3306);
define('DB_NAME', 'kristwin_db');
define('DB_USER', 'root');
define('DB_PASS', '');

define('APP_TIMEZONE', 'Asia/Manila');

// A low-performing product selling fewer units than this in a year is "Low Demand",
// otherwise "Slow Moving".
define('LOW_DEMAND_UNITS', 500);

// Stock within this margin above the reorder level is flagged "Reorder Soon" (0.10 = 10%).
define('REORDER_SOON_MARGIN', 0.10);
