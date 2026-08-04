export default function ViewportGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="cantarella-supported-viewport">{children}</div>

      <main className="cantarella-unsupported-viewport relative min-h-dvh w-full overflow-hidden bg-[var(--bg)] px-6 font-[family-name:var(--font-body)] text-[var(--text)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[48vh] bg-[radial-gradient(ellipse_at_50%_0%,rgba(201,147,90,0.12),transparent_68%)]" />
        <div className="pointer-events-none absolute -bottom-[20vh] -right-[20vw] h-[58vh] w-[78vw] bg-[radial-gradient(ellipse_at_center,rgba(201,147,90,0.05),transparent_70%)]" />

        <section className="relative z-10 flex max-w-[430px] flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border2)] bg-gradient-to-br from-[#2A1F14] to-[#3D2A18] font-[family-name:var(--font-display)] text-[24px] text-[var(--amber)] shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            C
          </div>

          <p className="mt-8 text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--amber)]">
            Desktop preview
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-[36px] font-light leading-[1.05] tracking-wide">
            Cantarella needs a little more room
          </h1>
          <p className="mt-5 max-w-[350px] text-[13px] font-light leading-6 tracking-wide text-[var(--text-secondary)]">
            V1 is made for laptops and desktops. Tablet landscape may work, while proper mobile support arrives in V1.5.
          </p>

          <div className="mt-8 h-px w-24 bg-gradient-to-r from-transparent via-[var(--amber)] to-transparent opacity-45" />
          <p className="mt-5 text-[11px] tracking-wide text-[var(--text-dim)]">
            Open this on a larger screen to continue
          </p>
        </section>
      </main>
    </>
  );
}
