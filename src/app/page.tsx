import { ROUTE_KEYS, getRouteStrategy } from "@/domain/routes";

export default function Home() {
  return (
    <main className="shell">
      <section className="home-hero">
        <p className="day-badge">21 天陪跑 · 第 1 天</p>
        <h1>不用一次想清楚，今天先推进一件事。</h1>
        <p className="lead">你现在最想先解决哪件事？</p>
        <p className="muted">先选你今天最卡的一件事，后面只会给一个小行动。</p>
      </section>

      <section className="route-list" aria-label="选择当前卡点">
        {ROUTE_KEYS.map((routeKey) => {
          const route = getRouteStrategy(routeKey);
          return (
            <a className="route-card" href={`/routes/${routeKey}/input`} key={routeKey}>
              <span>{route.label}</span>
              <strong>开始</strong>
            </a>
          );
        })}
      </section>

      <section className="home-footer">
        <a className="secondary-button" href="/track">我的求职轨迹</a>
        <p>今天只需要完成一个 15-30 分钟的小行动。</p>
      </section>
    </main>
  );
}

