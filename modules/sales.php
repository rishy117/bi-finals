<?php
// Sales transactions. Recording a sale deducts stock; voiding it returns the stock.

const SALE_SELECT = 'SELECT s.*, p.name AS product_name, p.unit FROM sales s LEFT JOIN products p ON p.id = s.product_id';

route('GET', '/sales', fn() => array_map('sale_view', rows(SALE_SELECT . ' ORDER BY s.sale_date DESC, s.id DESC')));

route('POST', '/sales', function ($ctx) {
    $b = $ctx['body'];
    $id = transaction(function () use ($b, $ctx) {
        // Lock the product row so two cashiers cannot sell the same last item.
        $product = row('SELECT * FROM products WHERE id = ? FOR UPDATE', [(int) ($b['productId'] ?? 0)]);
        if (!$product) throw new HttpError(404, 'Product not found.');
        $qty = number($b['qty'] ?? '', 'Quantity', 1, true);
        $unitPrice = number(($b['unitPrice'] ?? '') === '' ? $product['price'] : $b['unitPrice'], 'Unit price');
        $discount = number(($b['discount'] ?? '') === '' ? 0 : $b['discount'], 'Discount');
        $amount = round($qty * $unitPrice - $discount, 2);
        if ($amount < 0) throw new HttpError(400, 'Discount cannot be larger than the sale amount.');
        if ($qty > (int) $product['stock']) {
            throw new HttpError(400, "Not enough stock. Only {$product['stock']} {$product['unit']} of {$product['name']} left.");
        }
        q(
            'INSERT INTO sales (txn_no, sale_date, product_id, qty, unit_price, discount, amount, customer, channel, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                'TMP-' . bin2hex(random_bytes(6)),
                date_str(($b['date'] ?? '') ?: today(), 'Date'),
                $product['id'],
                $qty,
                $unitPrice,
                $discount,
                $amount,
                text($b['customer'] ?? '', 'Customer', false, 80) ?: 'Walk-in',
                one_of(($b['channel'] ?? '') ?: 'In-store', CHANNELS, 'Channel'),
                $ctx['user']['full_name'],
            ]
        );
        $id = (int) db()->lastInsertId();
        q('UPDATE sales SET txn_no = ? WHERE id = ?', [sprintf('TXN-%05d', $id), $id]);
        q('UPDATE products SET stock = stock - ? WHERE id = ?', [$qty, $product['id']]);
        return $id;
    });
    return sale_view(row(SALE_SELECT . ' WHERE s.id = ?', [$id]));
});

route('DELETE', '/sales/:id', function ($ctx) {
    require_admin($ctx['user']);
    transaction(function () use ($ctx) {
        $sale = row('SELECT * FROM sales WHERE id = ? FOR UPDATE', [(int) $ctx['params']['id']]);
        if (!$sale) throw new HttpError(404, 'Sale not found.');
        q('UPDATE products SET stock = stock + ? WHERE id = ?', [$sale['qty'], $sale['product_id']]);
        q('DELETE FROM sales WHERE id = ?', [$sale['id']]);
    });
    return ['ok' => true];
});
