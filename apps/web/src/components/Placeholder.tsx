export function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <main style={{ padding: '28px', maxWidth: '60ch' }}>
      <h2 style={{ fontFamily: 'var(--display)', margin: '0 0 8px' }}>{title}</h2>
      <p style={{ color: 'var(--muted)', margin: 0 }}>{text}</p>
    </main>
  );
}
