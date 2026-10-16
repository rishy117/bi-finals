<?php
// BI dashboard: KPIs, monthly sales, sales by product, inventory, procurement, low performers

route('GET', '/dashboard', function ($ctx) {
    $curYear = (int) date('Y');
    $years = array_map('intval', array_column(rows('SELECT DISTINCT YEAR(sale_date) AS y FROM sales ORDER BY y DESC'), 'y'));
    if (!$years) $years = [$curYear];
    $year = in_array((int) ($ctx['query']['year'] ?? 0), $years, true) ? (int) $ctx['query']['year'] : $years[0];
    $monthsCount = $year === $curYear ? (int) date('n') : 12;
    $from = "$year-01-01";
    $to = "$year-12-31";

    // Monthly totals
    $months = array_fill(0, 12, 0.0);
    foreach (rows('SELECT MONTH(sale_date) AS m, SUM(amount) AS total FROM sales WHERE sale_date BETWEEN ? AND ? GROUP BY m', [$from, $to]) as $r) {
        $months[(int) $r['m'] - 1] = round((float) $r['total'], 2);
    }
    $total = round(array_sum($months), 2);

    $highest = ['month' => 0, 'total' => $months[0]];
    $lowest = ['month' => 0, 'total' => $months[0]];
    for ($i = 1; $i < $monthsCount; $i++) {
        if ($months[$i] > $highest['total']) $highest = ['month' => $i, 'total' => $months[$i]];
        if ($months[$i] < $lowest['total']) $lowest = ['month' => $i, 'total' => $months[$i]];
    }

    // Peak months = two highest-selling months
    $ranked = array_filter($months, fn($t) => $t > 0);
    arsort($ranked);
    $peaks = array_keys(array_slice($ranked, 0, 2, true));
    sort($peaks);

    // Sales per product (products with no sales included as 0)
    $perProduct = rows(
        'SELECT p.id, p.name, COALESCE(SUM(s.amount), 0) AS amount, COALESCE(SUM(s.qty), 0) AS units
         FROM products p
         LEFT JOIN sales s ON s.product_id = p.id AND s.sale_date BETWEEN ? AND ?
         GROUP BY p.id, p.name',
        [$from, $to]
    );
    $perProduct = array_map(fn($r) => ['name' => $r['name'], 'amount' => round((float) $r['amount'], 2), 'units' => (int) $r['units']], $perProduct);

    // Donut: top 5 + "Other Products"
    $selling = array_values(array_filter($perProduct, fn($r) => $r['amount'] > 0));
    usort($selling, fn($a, $b) => $b['amount'] <=> $a['amount']);
    $byProduct = array_map(fn($r) => ['name' => $r['name'], 'amount' => $r['amount']], array_slice($selling, 0, 5));
    $rest = array_sum(array_column(array_slice($selling, 5), 'amount'));
    if ($rest > 0) $byProduct[] = ['name' => 'Other Products', 'amount' => round($rest, 2), 'other' => true];
    foreach ($byProduct as &$b) $b['pct'] = $total ? $b['amount'] / $total * 100 : 0;
    unset($b);

    // Low-performing: the 4 lowest-selling products
    $lowDemand = LOW_DEMAND_UNITS * $monthsCount / 12;
    $low = $perProduct;
    usort($low, fn($a, $b) => ($a['amount'] <=> $b['amount']) ?: strcmp($a['name'], $b['name']));
    $lowPerforming = array_map(fn($r) => $r + [
        'status' => $r['units'] === 0 ? 'No Sales' : ($r['units'] < $lowDemand ? 'Low Demand' : 'Slow Moving'),
    ], array_slice($low, 0, 4));

    // Procurement: 5 most recent purchase orders, oldest first
    $recent = array_reverse(rows(PO_SELECT . ' ORDER BY po.order_date DESC, po.id DESC LIMIT 5'));

    return [
        'year' => $year,
        'years' => $years,
        'periodLabel' => $monthsCount === 1 ? "Jan $year" : 'Jan–' . MONTHS[$monthsCount - 1] . " $year",
        'months' => $months,
        'peaks' => $peaks,
        'kpis' => [
            'total' => $total,
            'average' => round($total / $monthsCount, 2),
            'avgMonths' => $monthsCount,
            'highest' => $highest,
            'lowest' => $lowest,
        ],
        'byProduct' => $byProduct,
        'inventory' => array_map('product_view', rows('SELECT * FROM products ORDER BY id')),
        'procurement' => po_views($recent),
        'lowPerforming' => $lowPerforming,
    ];
});
