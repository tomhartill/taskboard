export function SignIn() {
  const refused = new URLSearchParams(location.search).get('signin') === 'refused';
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 'min(360px, 100%)' }}>
        <h1 style={{ fontFamily: 'var(--display)', textTransform: 'uppercase', fontSize: 30, margin: 0 }}>Tasks</h1>
        {refused && <p style={{ color: 'var(--danger)', margin: 0 }}>That Google account isn't allowed on this board.</p>}
        <a className="btn btn-primary" href="/api/v1/auth/google" style={{ textDecoration: 'none' }}>
          Sign in with Google
        </a>
      </div>
    </main>
  );
}
