const Bar = ({ w = "100%", h }) => <div className="skeleton" style={{ width: w, height: h }} />;

export default function Skeleton() {
  return (
    <>
      <section className="kpis">
        {[0, 1, 2, 3].map((i) => (
          <div className="kpi" key={i}><Bar w="40%" /><Bar w="55%" h={30} /><Bar w="70%" /></div>
        ))}
      </section>
      <section className="layout">
        <div className="panel">
          <div className="cards">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div className="card" key={i}><Bar w="50%" /><Bar w="30%" h={34} /><Bar h={10} /><Bar w="80%" /></div>
            ))}
          </div>
        </div>
        <aside className="panel panel-side">
          <div className="side-body">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} style={{ padding: "10px 8px" }}><Bar w="60%" /><div style={{ height: 8 }} /><Bar h={6} /></div>
            ))}
          </div>
        </aside>
      </section>
    </>
  );
}
