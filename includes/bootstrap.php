<?php
declare(strict_types=1);

require_once __DIR__ . '/../config.php';
date_default_timezone_set(APP_TIMEZONE);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CATEGORIES = ['School Supplies', 'Office Supplies', 'Custom Souvenirs', 'Craft Products'];
const CHANNELS = ['In-store', 'Messenger'];
const ROLES = ['admin', 'staff'];
const PO_FLOW = [
    'Pending' => ['In Progress', 'Delivered', 'Cancelled'],
    'In Progress' => ['Delivered', 'Cancelled'],
    'Delivered' => [],
    'Cancelled' => [],
];

class HttpError extends Exception
{
    public int $status;

    public function __construct(int $status, string $message)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

// ---------------------------------------------------------------- database

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        try {
            $pdo = new PDO(
                'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4',
                DB_USER,
                DB_PASS,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES => false,
                ]
            );
        } catch (PDOException $e) {
            if (stripos($e->getMessage(), 'Unknown database') !== false) {
                throw new HttpError(503, 'The database "' . DB_NAME . '" does not exist yet. Open install.php, or import database/kristwin_db.sql in phpMyAdmin.');
            }
            throw new HttpError(503, 'Cannot connect to MySQL. Start MySQL in the XAMPP Control Panel.');
        }
    }
    return $pdo;
}

function q(string $sql, array $params = []): PDOStatement
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt;
}

function rows(string $sql, array $params = []): array
{
    return q($sql, $params)->fetchAll();
}

function row(string $sql, array $params = []): ?array
{
    $r = q($sql, $params)->fetch();
    return $r === false ? null : $r;
}

function scalar(string $sql, array $params = [])
{
    return q($sql, $params)->fetchColumn();
}

function transaction(callable $fn)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $result = $fn();
        $pdo->commit();
        return $result;
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

// ---------------------------------------------------------------- validation

function text($value, string $label, bool $required = true, int $max = 120): string
{
    $s = trim((string) ($value ?? ''));
    if ($required && $s === '') throw new HttpError(400, "$label is required.");
    if (mb_strlen($s) > $max) throw new HttpError(400, "$label must be at most $max characters.");
    return $s;
}

function number($value, string $label, float $min = 0, bool $integer = false)
{
    if ($value === '' || $value === null || !is_numeric($value)) throw new HttpError(400, "$label must be a number.");
    $n = $value + 0;
    if ($integer && floor((float) $n) != $n) throw new HttpError(400, "$label must be a whole number.");
    if ($n < $min) throw new HttpError(400, "$label must be at least " . (0 + $min) . '.');
    return $integer ? (int) $n : round((float) $n, 2);
}

function date_str($value, string $label): string
{
    $s = (string) ($value ?? '');
    $d = DateTime::createFromFormat('!Y-m-d', $s);
    if (!$d || $d->format('Y-m-d') !== $s) throw new HttpError(400, "$label must be a valid date.");
    return $s;
}

function one_of($value, array $list, string $label): string
{
    if (!in_array($value, $list, true)) throw new HttpError(400, "$label must be one of: " . implode(', ', $list) . '.');
    return $value;
}

function find_or_404(string $table, $id, string $label): array
{
    $r = row("SELECT * FROM `$table` WHERE id = ?", [(int) $id]);
    if (!$r) throw new HttpError(404, "$label not found.");
    return $r;
}

function today(): string
{
    return date('Y-m-d');
}

// ---------------------------------------------------------------- auth

function start_session(): void
{
    if (session_status() === PHP_SESSION_NONE) {
        session_name('KRISTWINSESSID');
        session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax']);
        session_start();
    }
}

function current_user(): array
{
    start_session();
    $id = $_SESSION['user_id'] ?? null;
    $user = $id ? row('SELECT * FROM users WHERE id = ?', [$id]) : null;
    if (!$user) throw new HttpError(401, 'Please log in.');
    return $user;
}

function require_admin(array $user): void
{
    if ($user['role'] !== 'admin') throw new HttpError(403, 'Only an administrator can do this.');
}

// ---------------------------------------------------------------- views (DB row -> JSON shape)

function stock_status(int $stock, int $reorder): string
{
    if ($stock <= 0) return 'Out of Stock';
    if ($stock < $reorder) return 'Low Stock';
    if ($stock <= (int) ceil($reorder * (1 + REORDER_SOON_MARGIN))) return 'Reorder Soon';
    return 'In Stock';
}

function product_view(array $p): array
{
    return [
        'id' => (int) $p['id'],
        'code' => $p['code'],
        'name' => $p['name'],
        'category' => $p['category'],
        'unit' => $p['unit'],
        'price' => (float) $p['price'],
        'stock' => (int) $p['stock'],
        'reorderLevel' => (int) $p['reorder_level'],
        'status' => stock_status((int) $p['stock'], (int) $p['reorder_level']),
    ];
}

function sale_view(array $s): array
{
    return [
        'id' => (int) $s['id'],
        'txnNo' => $s['txn_no'],
        'date' => $s['sale_date'],
        'productId' => (int) $s['product_id'],
        'productName' => $s['product_name'] ?? '(deleted product)',
        'unit' => $s['unit'] ?? '',
        'qty' => (int) $s['qty'],
        'unitPrice' => (float) $s['unit_price'],
        'discount' => (float) $s['discount'],
        'amount' => (float) $s['amount'],
        'customer' => $s['customer'],
        'channel' => $s['channel'],
        'createdBy' => $s['created_by'],
    ];
}

function supplier_view(array $s): array
{
    return [
        'id' => (int) $s['id'],
        'name' => $s['name'],
        'contactPerson' => $s['contact_person'],
        'phone' => $s['phone'],
        'email' => $s['email'],
        'address' => $s['address'],
        'poCount' => (int) ($s['po_count'] ?? 0),
    ];
}

function user_view(array $u): array
{
    return [
        'id' => (int) $u['id'],
        'username' => $u['username'],
        'name' => $u['full_name'],
        'role' => $u['role'],
        'createdAt' => $u['created_at'],
    ];
}

/** Loads purchase orders (with supplier name and line items) in the JSON shape the UI uses. */
function po_views(array $pos): array
{
    if (!$pos) return [];
    $ids = array_map(fn($po) => (int) $po['id'], $pos);
    $marks = implode(',', array_fill(0, count($ids), '?'));
    $items = rows(
        "SELECT i.*, p.name AS product_name, p.unit FROM purchase_order_items i
         LEFT JOIN products p ON p.id = i.product_id WHERE i.po_id IN ($marks) ORDER BY i.id",
        $ids
    );
    $byPo = [];
    foreach ($items as $it) {
        $byPo[(int) $it['po_id']][] = [
            'productId' => (int) $it['product_id'],
            'productName' => $it['product_name'] ?? '(deleted product)',
            'unit' => $it['unit'] ?? '',
            'qty' => (int) $it['qty'],
            'unitCost' => (float) $it['unit_cost'],
            'lineTotal' => round($it['qty'] * $it['unit_cost'], 2),
        ];
    }
    return array_map(function ($po) use ($byPo) {
        $list = $byPo[(int) $po['id']] ?? [];
        return [
            'id' => (int) $po['id'],
            'poNo' => $po['po_no'],
            'supplierId' => (int) $po['supplier_id'],
            'supplierName' => $po['supplier_name'] ?? '(deleted supplier)',
            'date' => $po['order_date'],
            'status' => $po['status'],
            'notes' => $po['notes'],
            'deliveredAt' => $po['delivered_at'],
            'items' => $list,
            'itemCount' => count($list),
            'totalQty' => array_sum(array_column($list, 'qty')),
            'totalCost' => round(array_sum(array_column($list, 'lineTotal')), 2),
        ];
    }, $pos);
}

const PO_SELECT = 'SELECT po.*, s.name AS supplier_name FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id';

function po_view_by_id(int $id): array
{
    return po_views(rows(PO_SELECT . ' WHERE po.id = ?', [$id]))[0];
}
