import content from "../content/sites/test-bistro-two/content.json";

export function TestMenu({ locale }: { locale: "it" | "en" }) {
  return (
    <main style={{ maxWidth: 760, margin: "64px auto", padding: "0 24px", fontFamily: "Arial, sans-serif", lineHeight: 1.6 }}>
      <nav><a href="/">Italiano</a> · <a href="/en/">English</a> · <a href="/admin/">CMS</a></nav>
      <h1>{content.site.name[locale]}</h1>
      <p>{content.site.description[locale]}</p>
      {content.menuCategories.map((category) => (
        <section key={category.id}>
          <h2>{category.title[locale]}</h2>
          {category.items.filter((item) => item.available !== false).map((item) => (
            <article key={item.id} style={{ borderBottom: "1px solid #ddd", padding: "16px 0" }}>
              <h3>{item.name[locale]} <span style={{ float: "right" }}>€ {item.price}</span></h3>
              <p>{item.description[locale]}</p>
            </article>
          ))}
        </section>
      ))}
    </main>
  );
}
