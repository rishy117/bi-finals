<?php
// Procurement: purchase orders and their items.
// Status flow: Pending -> In Progress -> Delivered (or Cancelled). Delivered adds items to stock.

function purchase_input(array $b): array
{
    $supplier = find_or_404('suppliers', $b['supplierId'] ?? 0, 'Supplier');
    $lines = $b['items'] ?? null;
    if (!is_array($lines) || !$lines) throw new HttpError(400, 'Add at least one item.');
    $seen = [];
    $items = [];
    foreach (array_values($lines) as $i => $it) {
        $n = $i + 1;
        $product = find_or_404('products', $it['productId'] ?? 0, "Product on line $n");
        if (isset($seen[$product['id']])) throw new HttpError(400, "{$product['name']} is listed more than once.");
        $seen[$product['id']] = true;
        $items[] = [
            'product_id' => (int) $product['id'],
            'qty' => number($it['qty'] ?? '', "Quantity on line $n", 1, true),
            'unit_cost' => number($it['unitCost'] ?? '', "Unit cost on line $n"),
        ];
    }
    return [
        'supplier_id' => (int) $supplier['id'],
        'order_date' => date_str(($b['date'] ?? '') ?: today(), 'Date'),
        'notes' => text($b['notes'] ?? '', 'Notes', false, 300),
        'items' => $items,
    ];
}

function save_po_items(int $poId, array $items): void
{
    q('DELETE FROM purchase_order_items WHERE po_id = ?', [$poId]);
    foreach ($items as $it) {
        q('INSERT INTO purchase_order_items (po_id, product_id, qty, unit_cost) VALUES (?, ?, ?, ?)', [$poId, $it['product_id'], $it['qty'], $it['unit_cost']]);
    }
}

route('GET', '/purchases', fn() => po_views(rows(PO_SELECT . ' ORDER BY po.order_date DESC, po.id DESC')));

route('POST', '/purchases', function ($ctx) {
    $in = purchase_input($ctx['body']);
    $id = transaction(function () use ($in) {
        $year = substr($in['order_date'], 0, 4);
        $last = (int) scalar("SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(po_no, '-', -1) AS UNSIGNED)), 0) FROM purchase_orders WHERE po_no LIKE ? FOR UPDATE", ["PO-$year-%"]);
        q(
            'INSERT INTO purchase_orders (po_no, supplier_id, order_date, status, notes) VALUES (?, ?, ?, ?, ?)',
            [sprintf('PO-%s-%03d', $year, $last + 1), $in['supplier_id'], $in['order_date'], 'Pending', $in['notes']]
        );
        $id = (int) db()->lastInsertId();
        save_po_items($id, $in['items']);
        return $id;
    });
    return po_view_by_id($id);
});

route('PUT', '/purchases/:id', function ($ctx) {
    $po = find_or_404('purchase_orders', $ctx['params']['id'], 'Purchase order');
    if (!PO_FLOW[$po['status']]) throw new HttpError(409, "{$po['status']} purchase orders can no longer be edited.");
    $in = purchase_input($ctx['body']);
    transaction(function () use ($po, $in) {
        q('UPDATE purchase_orders SET supplier_id = ?, order_date = ?, notes = ? WHERE id = ?', [$in['supplier_id'], $in['order_date'], $in['notes'], $po['id']]);
        save_po_items((int) $po['id'], $in['items']);
    });
    return po_view_by_id((int) $po['id']);
});

route('PATCH', '/purchases/:id/status', function ($ctx) {
    $status = (string) ($ctx['body']['status'] ?? '');
    $id = (int) $ctx['params']['id'];
    transaction(function () use ($id, $status) {
        $po = row('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [$id]);
        if (!$po) throw new HttpError(404, 'Purchase order not found.');
        if (!in_array($status, PO_FLOW[$po['status']], true)) {
            throw new HttpError(409, "Cannot change status from {$po['status']} to " . ($status ?: '(blank)') . '.');
        }
        q('UPDATE purchase_orders SET status = ? WHERE id = ?', [$status, $id]);
        if ($status === 'Delivered' && !(int) $po['stock_applied']) {
            q('UPDATE products p JOIN purchase_order_items i ON i.product_id = p.id SET p.stock = p.stock + i.qty WHERE i.po_id = ?', [$id]);
            q('UPDATE purchase_orders SET stock_applied = 1, delivered_at = ? WHERE id = ?', [today(), $id]);
        }
    });
    return po_view_by_id($id);
});

route('DELETE', '/purchases/:id', function ($ctx) {
    require_admin($ctx['user']);
    $po = find_or_404('purchase_orders', $ctx['params']['id'], 'Purchase order');
    if ($po['status'] === 'Delivered') throw new HttpError(409, 'Delivered purchase orders cannot be deleted.');
    q('DELETE FROM purchase_orders WHERE id = ?', [$po['id']]);
    return ['ok' => true];
});
