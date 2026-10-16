<?php
// User accounts (administrators only)

route('GET', '/users', function ($ctx) {
    require_admin($ctx['user']);
    return array_map('user_view', rows('SELECT * FROM users ORDER BY id'));
});

route('POST', '/users', function ($ctx) {
    require_admin($ctx['user']);
    $b = $ctx['body'];
    $username = strtolower(text($b['username'] ?? '', 'Username', true, 30));
    if (!preg_match('/^[a-z0-9._-]+$/', $username)) throw new HttpError(400, 'Username may only use letters, numbers, dots, dashes and underscores.');
    if (row('SELECT id FROM users WHERE LOWER(username) = ?', [$username])) throw new HttpError(409, 'That username is already taken.');
    $password = (string) ($b['password'] ?? '');
    if (strlen($password) < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
    q('INSERT INTO users (username, full_name, role, password_hash) VALUES (?, ?, ?, ?)', [
        $username,
        text($b['name'] ?? '', 'Full name', true, 80),
        one_of($b['role'] ?? '', ROLES, 'Role'),
        password_hash($password, PASSWORD_DEFAULT),
    ]);
    return user_view(find_or_404('users', db()->lastInsertId(), 'User'));
});

route('PUT', '/users/:id', function ($ctx) {
    require_admin($ctx['user']);
    $b = $ctx['body'];
    $target = find_or_404('users', $ctx['params']['id'], 'User');
    $role = one_of($b['role'] ?? '', ROLES, 'Role');
    if ((int) $target['id'] === (int) $ctx['user']['id'] && $role !== 'admin') {
        throw new HttpError(400, 'You cannot remove your own administrator role.');
    }
    q('UPDATE users SET full_name = ?, role = ? WHERE id = ?', [text($b['name'] ?? '', 'Full name', true, 80), $role, $target['id']]);
    if (!empty($b['password'])) {
        if (strlen((string) $b['password']) < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
        q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string) $b['password'], PASSWORD_DEFAULT), $target['id']]);
    }
    return user_view(find_or_404('users', $target['id'], 'User'));
});

route('DELETE', '/users/:id', function ($ctx) {
    require_admin($ctx['user']);
    $target = find_or_404('users', $ctx['params']['id'], 'User');
    if ((int) $target['id'] === (int) $ctx['user']['id']) throw new HttpError(400, 'You cannot delete your own account.');
    q('DELETE FROM users WHERE id = ?', [$target['id']]);
    return ['ok' => true];
});
