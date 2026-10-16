<?php
// JSON API used by the web interface. URLs look like api.php/products/5
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';

$ROUTES = [];

function route(string $method, string $pattern, callable $handler, bool $auth = true): void
{
    global $ROUTES;
    $regex = '#^' . preg_replace('#:(\w+)#', '(?P<$1>[^/]+)', $pattern) . '$#';
    $ROUTES[] = compact('method', 'regex', 'handler', 'auth');
}

require __DIR__ . '/modules/auth.php';
require __DIR__ . '/modules/dashboard.php';
require __DIR__ . '/modules/products.php';
require __DIR__ . '/modules/sales.php';
require __DIR__ . '/modules/suppliers.php';
require __DIR__ . '/modules/purchases.php';
require __DIR__ . '/modules/users.php';

function send_json(int $status, $data): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
}

try {
    $path = '/' . trim($_SERVER['PATH_INFO'] ?? '', '/');
    $method = $_SERVER['REQUEST_METHOD'];
    $match = null;
    foreach ($ROUTES as $r) {
        if ($r['method'] === $method && preg_match($r['regex'], $path, $m)) {
            $match = $r;
            $params = array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY);
            break;
        }
    }
    if (!$match) throw new HttpError(404, 'Not found.');

    $body = [];
    if (in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
        $raw = file_get_contents('php://input');
        $body = $raw === '' ? [] : json_decode($raw, true);
        if (!is_array($body)) throw new HttpError(400, 'Invalid JSON.');
    }
    $user = $match['auth'] ? current_user() : null;
    $result = ($match['handler'])([
        'body' => $body,
        'params' => $params,
        'query' => $_GET,
        'user' => $user,
    ]);
    send_json(200, $result ?? ['ok' => true]);
} catch (HttpError $e) {
    send_json($e->status, ['error' => $e->getMessage()]);
} catch (PDOException $e) {
    error_log((string) $e);
    // 23000 = integrity constraint (duplicate key / foreign key)
    $msg = $e->getCode() === '23000' ? 'That record conflicts with existing data (duplicate or still in use).' : 'Database error. Please try again.';
    send_json($e->getCode() === '23000' ? 409 : 500, ['error' => $msg]);
} catch (Throwable $e) {
    error_log((string) $e);
    send_json(500, ['error' => 'Something went wrong on the server.']);
}
