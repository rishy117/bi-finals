<?php
// Inventory (products)

function product_input(array $b, int $existingId = 0): array
{
    $p = [
        'code' => text($b['code'] ?? '', 'Product code', true, 20),
        'name' => text($b['name'] ?? '', 'Product name', true, 80),
        'category' => one_of($b['category'] ?? '', CATEGORIES, 'Category'),
        'unit' => text($b['unit'] ?? '', 'Unit', true, 20),
        'price' => number($b['price'] ?? '', 'Selling price'),
        'stock' => number($b['stock'] ?? '', 'Current stock', 0, true),
        'reorder_level' => number($b['reorderLevel'] ?? '', 'Reorder level', 0, true),
    ];
    $clash = row('SELECT code, name FROM products WHERE id <> ? AND (LOWER(code) = LOWER(?) OR LOWER(name) = LOWER(?))', [$existingId, $p['code'], $p['name']]);
    if ($clash) {
        $field = strcasecmp($clash['code'], $p['code']) === 0 ? 'code' : 'name';
        throw new HttpError(409, "A product with that $field already exists.");
    }
    return $p;
}

route('GET', '/products', fn() => array_map('product_view', rows('SELECT * FROM products ORDER BY id')));

route('POST', '/products', function ($ctx) {
    $p = product_input($ctx['body']);
    q('INSERT INTO products (code, name, category, unit, price, stock, reorder_level) VALUES (?, ?, ?, ?, ?, ?, ?)', array_values($p));
    return product_view(find_or_404('products', db()->lastInsertId(), 'Product'));
});

route('PUT', '/products/:id', function ($ctx) {
    $existing = find_or_404('products', $ctx['params']['id'], 'Product');
    $p = product_input($ctx['body'], (int) $existing['id']);
    q('UPDATE products SET code = ?, name = ?, category = ?, unit = ?, price = ?, stock = ?, reorder_level = ? WHERE id = ?', [...array_values($p), $existing['id']]);
    return product_view(find_or_404('products', $existing['id'], 'Product'));
});

route('DELETE', '/products/:id', function ($ctx) {
    require_admin($ctx['user']);
    $p = find_or_404('products', $ctx['params']['id'], 'Product');
    $used = scalar('SELECT (SELECT COUNT(*) FROM sales WHERE product_id = ?) + (SELECT COUNT(*) FROM purchase_order_items WHERE product_id = ?)', [$p['id'], $p['id']]);
    if ($used > 0) throw new HttpError(409, "{$p['name']} has sales or purchase records and cannot be deleted.");
    q('DELETE FROM products WHERE id = ?', [$p['id']]);
    return ['ok' => true];
});
