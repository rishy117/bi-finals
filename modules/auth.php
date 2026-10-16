<?php
// Login / logout / current user

route('POST', '/login', function ($ctx) {
    start_session();
    $username = strtolower(trim((string) ($ctx['body']['username'] ?? '')));
    $user = row('SELECT * FROM users WHERE LOWER(username) = ?', [$username]);
    if (!$user || !password_verify((string) ($ctx['body']['password'] ?? ''), $user['password_hash'])) {
        throw new HttpError(401, 'Incorrect username or password.');
    }
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) $user['id'];
    return ['user' => user_view($user)];
}, false);

route('POST', '/logout', function () {
    start_session();
    $_SESSION = [];
    session_destroy();
    return ['ok' => true];
}, false);

route('GET', '/me', fn($ctx) => ['user' => user_view($ctx['user'])]);
