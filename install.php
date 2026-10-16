<?php
// One-click database setup: creates kristwin_db and loads database/kristwin_db.sql.
// Same result as importing that file in phpMyAdmin.
declare(strict_types=1);
require_once __DIR__ . '/config.php';

mysqli_report(MYSQLI_REPORT_OFF);
$sqlFile = __DIR__ . '/database/kristwin_db.sql';
$message = '';
$ok = false;

$conn = @new mysqli(DB_HOST, DB_USER, DB_PASS, '', DB_PORT);
$connected = !$conn->connect_errno;
$exists = false;
$counts = [];
if ($connected) {
    $conn->set_charset('utf8mb4');
    $res = $conn->query("SHOW DATABASES LIKE '" . $conn->real_escape_string(DB_NAME) . "'");
    $exists = $res && $res->num_rows > 0;
}

if ($connected && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if ($exists && ($_POST['confirm'] ?? '') !== 'RESET') {
        $message = 'Type RESET to confirm. This erases all current data.';
    } else {
        $sql = file_get_contents($sqlFile);
        if ($conn->multi_query($sql)) {
            do {
                if ($r = $conn->store_result()) $r->free();
            } while ($conn->more_results() && $conn->next_result());
        }
        if ($conn->errno) {
            $message = 'Import failed: ' . $conn->error;
        } else {
            $ok = true;
            $exists = true;
            $message = 'Database installed successfully.';
        }
    }
}

if ($connected && $exists) {
    $conn->select_db(DB_NAME);
    foreach (['users', 'products', 'suppliers', 'sales', 'purchase_orders', 'purchase_order_items'] as $t) {
        $r = $conn->query("SELECT COUNT(*) FROM `$t`");
        $counts[$t] = $r ? (int) $r->fetch_row()[0] : null;
    }
}
$h = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Install Database</title>
  <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
  <div class="login">
    <form method="post" class="login-card" style="max-width:460px">
      <div class="login-brand">
        <div class="logo-box"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h14M8 16v-5M12 16V7M16 16v-3"/></svg></div>
        <div><h1>Database Setup</h1><p>Kristwin Consumer Goods Trading BI System</p></div>
      </div>

      <?php if (!$connected): ?>
        <div class="form-error">Cannot connect to MySQL at <?= $h(DB_HOST) ?>. Open the XAMPP Control Panel and click <b>Start</b> beside MySQL, then reload this page.</div>
      <?php else: ?>
        <?php if ($message): ?>
          <div class="<?= $ok ? 'info-line' : 'form-error' ?>"><?= $h($message) ?></div>
        <?php endif; ?>

        <?php if ($exists): ?>
          <p style="font-size:13px">Database <b><?= $h(DB_NAME) ?></b> is installed:</p>
          <table class="tbl"><tbody>
            <?php foreach ($counts as $t => $n): ?>
              <tr><td><?= $h($t) ?></td><td class="r"><?= $n === null ? 'missing' : number_format($n) ?> rows</td></tr>
            <?php endforeach; ?>
          </tbody></table>
          <a class="btn primary block" href="./">Open the system →</a>
          <hr style="border:0;border-top:1px solid var(--border);width:100%">
          <label>Reset to sample data — type RESET to confirm
            <input name="confirm" autocomplete="off" placeholder="RESET">
          </label>
          <button class="btn danger block" type="submit">Reset database</button>
        <?php else: ?>
          <p style="font-size:13px">This creates the database <b><?= $h(DB_NAME) ?></b> with all tables and the 2025 sample data
            from <code>database/kristwin_db.sql</code>.</p>
          <button class="btn primary block" type="submit">Install database</button>
        <?php endif; ?>
      <?php endif; ?>
      <p class="login-hint">Sample accounts: <b>admin</b> / admin123 · <b>staff</b> / staff123</p>
    </form>
  </div>
</body>
</html>
