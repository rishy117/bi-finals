<?php
// Suppliers

function supplier_input(array $b, int $existingId = 0): array
{
    $s = [
        'name' => text($b['name'] ?? '', 'Supplier name', true, 80),
        'contact_person' => text($b['contactPerson'] ?? '', 'Contact person', false, 80),
        'phone' => text($b['phone'] ?? '', 'Phone', false, 40),
        'email' => text($b['email'] ?? '', 'Email / Messenger', false, 120),
        'address' => text($b['address'] ?? '', 'Address', false, 160),
    ];
    if (row('SELECT id FROM suppliers WHERE id <> ? AND LOWER(name) = LOWER(?)', [$existingId, $s['name']])) {
        throw new HttpError(409, 'A supplier with that name already exists.');
    }
    return $s;
}

function supplier_by_id(int $id): array
{
    return supplier_view(row('SELECT s.*, (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = s.id) AS po_count FROM suppliers s WHERE s.id = ?', [$id]));
}

route('GET', '/suppliers', fn() => array_map('supplier_view', rows(
    'SELECT s.*, (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = s.id) AS po_count FROM suppliers s ORDER BY s.id'
)));

route('POST', '/suppliers', function ($ctx) {
    $s = supplier_input($ctx['body']);
    q('INSERT INTO suppliers (name, contact_person, phone, email, address) VALUES (?, ?, ?, ?, ?)', array_values($s));
    return supplier_by_id((int) db()->lastInsertId());
});

route('PUT', '/suppliers/:id', function ($ctx) {
    $existing = find_or_404('suppliers', $ctx['params']['id'], 'Supplier');
    $s = supplier_input($ctx['body'], (int) $existing['id']);
    q('UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ? WHERE id = ?', [...array_values($s), $existing['id']]);
    return supplier_by_id((int) $existing['id']);
});

route('DELETE', '/suppliers/:id', function ($ctx) {
    require_admin($ctx['user']);
    $s = find_or_404('suppliers', $ctx['params']['id'], 'Supplier');
    if (scalar('SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = ?', [$s['id']]) > 0) {
        throw new HttpError(409, "{$s['name']} has purchase orders and cannot be deleted.");
    }
    q('DELETE FROM suppliers WHERE id = ?', [$s['id']]);
    return ['ok' => true];
});
