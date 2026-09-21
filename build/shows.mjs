/* ============================================================
   KRAMER — the register of shows
   One entry per exhibition, newest first. build/build.mjs derives the rest:
   the show pages, /expositions/, /artistes/, the home page's registers, carousel,
   JSON-LD and meta descriptions, and the sitemap.

   It lives here rather than in index.html beside ARTISTS because it carries prose
   and event records the home page never reads at runtime — index.html ships to
   every visitor.

   Fields
     code, slug, title       registry code (KR02), URL slug, title as shown
     from, to                ISO dates. STATUS IS NOT STORED: à venir / en cours /
                             terminée is derived from these and today's date
                             (Europe/Paris), so it cannot go stale in the data
     dates                   display form, «28 septembre – 1er octobre 2026»
     hours, cur              optional: opening hours; curators («Commissariat · …»)
     desc                    JSON-LD description
     metaDesc                optional <meta> description override for the show page
     org                     optional extra organizers (JSON-LD nodes, beside the gallery)
     artists                 names, in the order announced. A name matching an ARTISTS
                             record links to that artist's page and puts the show in
                             their «Au registre» line; any other name is plain text.
                             This is the ONLY place show membership is recorded.
     prose {fr, en}          optional statement (HTML paragraphs), FR/EN toggle
     views [{f, alt, car}]   installation views, files in images/installation/.
                             car:1 puts a view in the home-page carousel while the
                             show is the current one
     events [...]            vernissage, screening, dinner… see the entries below.
                             Once their day has passed they also fill the home
                             page's Registre des événements
     press [{d, pub, t, by, url}]
                             coverage — d is YYYY, YYYY-MM or YYYY-MM-DD. Rendered
                             newest first, and only when the list is not empty.
                             ARTISTS records take the same optional press:[]
     docs [{t, url}]         the gallery's own documents (press release, invitation)

   Strings named html (title, meta, note, prog) are inserted as written; the rest
   is escaped. Everything here is public — this folder is a public repo.
============================================================ */
const SITE = 'https://kramer.paris';
const U1 = `${SITE}/expositions/kr01-la-bride/`;
const U2 = `${SITE}/expositions/kr02-self/`;

export const SHOWS = [
  /* KR03 — add when TASKS.md #79 clears. Copy the KR02 entry below as the template. */
  {
    code: 'KR02', slug: 'kr02-self', title: 'SELF™',
    from: '2026-09-28', to: '2026-10-01',
    dates: '28 septembre – 1er octobre 2026', hours: '11h–18h',
    cur: 'Shelly Lea Reich & Claire Koron Elat (Angels)',
    desc: '« SELF™ » (KR02) — exposition collective de six artistes, commissariat Shelly Lea Reich & Claire Koron Elat (Angels), du 28 septembre au 1er octobre 2026.',
    org: [{ '@type': 'Organization', name: 'Angels' }],
    artists: ['F1LTHY', 'Kristoffer Borgli', 'Sonny Hall', 'Pouria Khojastehpay', 'Noémie Ninot', 'Yury Belyavskiy'],
    views: [],
    events: [
      { kind: 'Vernissage', code: 'KR02', day: '2026-09-28',
        title: 'SELF™ — 28 septembre 2026, 18h–21h',
        note: "Ouverture de l'exposition « SELF™ ».",
        ld: [{ '@type': 'SocialEvent', '@id': `${U2}#vernissage`, name: 'Vernissage — SELF™',
          startDate: '2026-09-28T18:00:00+02:00', endDate: '2026-09-28T21:00:00+02:00',
          description: "Ouverture de l'exposition « SELF™ » (KR02)." }] },
    ],
    press: [], docs: [],
  },
  {
    code: 'KR01', slug: 'kr01-la-bride', title: 'La Bride',
    from: '2026-06-25', to: '2026-08-29',
    dates: '25 juin – 29 août 2026',
    desc: "« La Bride » (KR01) — exposition collective de dix artistes internationaux, du 25 juin au 29 août 2026.",
    metaDesc: "Kramer — galerie d'art contemporain, Paris 10e. Galerie d'appartement. Exposition « La Bride » (KR01), 25 juin–29 août 2026 : dix artistes internationaux.",
    artists: ['Annael Shavit', 'Gaia Del Santo', 'Henri Chetaille', 'Jaakko Uljas', 'Jürgen Baumann', 'Karim Hussein', 'Nanna Kaiser', 'Padyn Humble', 'Signe Ralkov', 'Tekla Kighuradze'],
    prose: {
      fr: `
          <p>Le déclencheur de cette exposition, c'est, pour l'essentiel, que le cheval préféré de mon frère a récemment été transformé en salami. Repose en paix, Brown Beauty. La seconde raison, la vraie, c'est que Gustav et Leon, de bendingwords, me prêtent leur bureau. Merci.</p>
          <p>Quant au titre : « La Bride » peut se lire aussi bien en anglais qu'en français. Les deux sens n'ont, au premier abord, rien à voir l'un avec l'autre, et l'observation n'est probablement qu'une coïncidence. Et pourtant, de cette tension, on peut tirer des questions communes de contrôle, de pouvoir et de désir. Si ces éléments venaient à affleurer dans les œuvres, libre à qui le souhaite de les suivre.</p>
          <p>Permettez-moi d'emprunter quelques pages à « Avoir ou être ? » d'Erich Fromm pour mieux comprendre tout cela. Deux poèmes y sont mis en regard, chacun reflétant une attitude différente face à la possession du savoir.</p>
          <p>D'abord, un poème du poète anglais du XIX<sup>e</sup> siècle, Tennyson :<br>Fleur dans les fissures du mur,<br>Je t'arrache aux fissures,<br>Je te tiens là, racine et tout, dans ma main,<br>Petite fleur — mais si je pouvais comprendre<br>Ce que tu es, racine et tout, et tout en tout,<br>Je saurais ce qu'est Dieu, et ce qu'est l'homme.</p>
          <p>Puis le haïku de Bashō, qui, en traduction, donne à peu près ceci :<br>Quand je regarde attentivement,<br>Je vois la nazuna en fleur<br>Près de la haie !</p>
          <p>(la nazuna est une fleur)</p>
          <p>Plutôt que d'examiner les œuvres réunies ici en quête d'un terrain commun — et, ce faisant, de déraciner la fleur pour finir par la tuer — vous — êtes — chaleureusement — invités — à — regarder — attentivement.</p>
          <p>Si l'on considère que les pratiques réunies ici viennent de Berlin, Copenhague, Zurich, Winterthour, Tbilissi, Vienne, Helsinki et Paris, il apparaît vite que regarder attentivement est la seule manière d'aborder les œuvres.</p>
          <p>Mais oui, l'exposition parle aussi de chevaux.</p>
`,
      en: `
          <p>The trigger for this exhibition is, essentially, that my brother's favourite horse was recently processed into salami. Rest in peace, Brown Beauty. The second, and real, reason is that Gustav and Leon from bendingwords are letting me use their office. Thank you.</p>
          <p>As for the title: « La Bride » can be read in both English and French. The two meanings have, at first, nothing to do with one another, and the observation is probably just a coincidence. And yet, from the tension, one can draw out shared questions of control, power, and desire. Should these elements surface in the works, anyone who wishes is welcome to follow them.</p>
          <p>Let me borrow a few pages from Erich Fromm's « To Have or To Be? » to understand this better. In it, two poems are set against one another, each reflecting a different stance toward possessing knowledge.</p>
          <p>First, one by the nineteenth-century English poet Tennyson:<br>Flower in the crannied wall,<br>I pluck you out of the crannies,<br>I hold you here, root and all, in my hand,<br>Little flower—but if I could understand<br>What you are, root and all, and all in all,<br>I should know what God and man is.</p>
          <p>Then Basho's haiku, which in translation runs more or less like this:<br>When I look carefully<br>I see the nazuna blooming<br>By the hedge!</p>
          <p>(nazuna is a flower)</p>
          <p>Rather than examining the works gathered here for common ground and thereby uprooting the flower, and ultimately killing it — you — are — warmly — invited — to — look — carefully.</p>
          <p>Considering that the practices gathered here come from Berlin, Copenhagen, Zurich, Winterthur, Tbilisi, Vienna, Helsinki, and Paris, it soon becomes clear that looking carefully is the only way to approach the works.</p>
          <p>But yes, the exhibition is also about horses.</p>
`,
    },
    views: [
    { f: "kr01-inst-01-humble-kighuradze.jpg", alt: "Vue d'installation de «La Bride», KRAMER — œuvres de Padyn Humble et Tekla Kighuradze" },
    { f: "kr01-inst-02-hussein.jpg", alt: "Vue d'installation de «La Bride», KRAMER — œuvres de Karim Hussein" },
    { f: "kr01-inst-03-kighuradze-ralkov.jpg", alt: "Vue d'installation de «La Bride», KRAMER — œuvres de Tekla Kighuradze et Signe Ralkov" },
    { f: "kr01-inst-04-kighuradze-shavit.jpg", alt: "Vue d'installation de «La Bride», KRAMER — œuvres de Tekla Kighuradze et Annael Shavit" },
    { f: "kr01-inst-05-baumann-chetaille.jpg", alt: "Vue d'installation de «La Bride», KRAMER — œuvres de Jürgen Baumann et Henri Chetaille" },
    { f: "kr01-inst-06-uljas.jpg", alt: "Vue d'installation de «La Bride», KRAMER — œuvres de Jaakko Uljas" },
    { f: "kr01-inst-07-baumann-uljas.jpg", alt: "Vue d'installation de «La Bride», KRAMER — œuvres de Jürgen Baumann et Jaakko Uljas" },
    { f: "kr01-inst-08-kaiser-del-santo.jpg", alt: "Vue d'installation de «La Bride», KRAMER — œuvres de Nanna Kaiser et Gaia Del Santo" },
    { f: "kr01-inst-09-baumann-del-santo.jpg", alt: "Vue d'installation de «La Bride», KRAMER — œuvres de Jürgen Baumann et Gaia Del Santo" },
    ],
    events: [
      { kind: 'Projection', code: 'KR01V', day: '2026-08-29',
        title: '<em>Horses in Motion</em> — 29 août 2026, 12h–18h',
        meta: ['Commissariat · Rahel Jung'],
        note: "Dix œuvres vidéo présentées le temps d'un après-midi, suivies d'un dîner.",
        prog: [
        ["Alina Orlov", "<em>The Cavalry</em>, 2024 · 17 min"],
        ["Arvin Arta", "<em>Germaxxing</em>, 2026 · 14 min"],
        ["David O'Reilly", "<em>The Horse Raised by Spheres</em>, 2014 · 3 min"],
        ["Elisa Jule Braun", "<em>The 4 Postapocalyptic Horses: Equus Simulatus und Hippospirulina Libica</em>, 2024/25 · 2 × 5 min"],
        ["Hsu Che-Yu", "<em>Demarcation</em>, 2023 · 17 min"],
        ["Jennifer Reeder", "<em>The Secret History</em>, 2002 · 5 min"],
        ["Josefin Arnell", "<em>Beast and Feast</em>, 2023 · 25 min"],
        ["Mike Hoolboom", "<em>3 Dreams of Horses</em>, 2018 · 5 min"],
        ["Moritz Stumm &amp; Stefan Neuberger", "<em>Kontrolle</em>, 2024 · 33 min"],
        ["Rhona Mühlebach", "<em>The River, the Horse, &amp; the Woman</em>, 2019 · 8 min"],
        ],
        note2: "Le TV Dinner a été préparé par Hadya, à partir de 19h. Le dîner a clos l'exposition « La Bride ».",
        ld: [
          {
            "@type": "ScreeningEvent",
            "@id": `${U1}#projection`,
            name: "Horses in Motion",
            startDate: "2026-08-29T12:00:00+02:00",
            endDate: "2026-08-29T18:00:00+02:00",
            isAccessibleForFree: true,
            performer: [
              { "@type": "Person", name: "Alina Orlov" },
              { "@type": "Person", name: "Arvin Arta" },
              { "@type": "Person", name: "David O'Reilly" },
              { "@type": "Person", name: "Elisa Jule Braun" },
              { "@type": "Person", name: "Hsu Che-Yu" },
              { "@type": "Person", name: "Jennifer Reeder" },
              { "@type": "Person", name: "Josefin Arnell" },
              { "@type": "Person", name: "Mike Hoolboom" },
              { "@type": "Person", name: "Moritz Stumm" },
              { "@type": "Person", name: "Stefan Neuberger" },
              { "@type": "Person", name: "Rhona Mühlebach" }
            ],
            workPresented: [
              { "@type": "Movie", name: "The Cavalry", copyrightYear: 2024, duration: "PT17M", director: { "@type": "Person", name: "Alina Orlov" } },
              { "@type": "Movie", name: "Germaxxing", copyrightYear: 2026, duration: "PT14M", director: { "@type": "Person", name: "Arvin Arta" } },
              { "@type": "Movie", name: "The Horse Raised by Spheres", copyrightYear: 2014, duration: "PT3M", director: { "@type": "Person", name: "David O'Reilly" } },
              { "@type": "Movie", name: "The 4 Postapocalyptic Horses: Equus Simulatus und Hippospirulina Libica", duration: "PT10M", director: { "@type": "Person", name: "Elisa Jule Braun" } },
              { "@type": "Movie", name: "Demarcation", copyrightYear: 2023, duration: "PT17M", director: { "@type": "Person", name: "Hsu Che-Yu" } },
              { "@type": "Movie", name: "The Secret History", copyrightYear: 2002, duration: "PT5M", director: { "@type": "Person", name: "Jennifer Reeder" } },
              { "@type": "Movie", name: "Beast and Feast", copyrightYear: 2023, duration: "PT25M", director: { "@type": "Person", name: "Josefin Arnell" } },
              { "@type": "Movie", name: "3 Dreams of Horses", copyrightYear: 2018, duration: "PT5M", director: { "@type": "Person", name: "Mike Hoolboom" } },
              { "@type": "Movie", name: "Kontrolle", copyrightYear: 2024, duration: "PT33M", director: [{ "@type": "Person", name: "Moritz Stumm" }, { "@type": "Person", name: "Stefan Neuberger" }] },
              { "@type": "Movie", name: "The River, the Horse, & the Woman", copyrightYear: 2019, duration: "PT8M", director: { "@type": "Person", name: "Rhona Mühlebach" } }
            ],
            subEvent: {
              "@id": `${U1}#dinner`
            },
            description: "Cycle de projections, commissariat Rahel Jung — programme « Horses in Motion »."
          },
          {
            "@type": "FoodEvent",
            "@id": `${U1}#dinner`,
            name: "TV Dinner — Hadya",
            startDate: "2026-08-29T19:00:00+02:00",
            superEvent: {
              "@id": `${U1}#projection`
            },
            description: "TV Dinner par Hadya — clôture de l'exposition « La Bride »."
          },
        ] },
      { kind: 'Vernissage', code: 'KR01', day: '2026-06-25',
        title: 'La Bride — 25 juin 2026, 17h–21h',
        meta: ['Sur présentation au registre'],
        note: "Ouverture de l'exposition « La Bride », dix artistes internationaux.",
        ld: [
          {
            "@type": "SocialEvent",
            "@id": `${U1}#vernissage`,
            name: "Vernissage — La Bride",
            startDate: "2026-06-25T17:00:00+02:00",
            endDate: "2026-06-25T21:00:00+02:00",
            description: "Ouverture de l'exposition « La Bride » (KR01), dix artistes internationaux."
          },
        ] },
    ],
    press: [], docs: [],
  },
];
