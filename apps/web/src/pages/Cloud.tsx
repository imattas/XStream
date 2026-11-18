import { startTransition, memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { api, Link, Loader, message } from '../components/ui'

import { inputLabels, type InputMode } from '../../../../input-modes'

const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
interface Game { description?: string; developer?: string; releaseDate?: string; inputs: InputMode[]; id: string; playable: boolean; name: string; publisher: string; cover: string; banner: string; categories: string[] }
interface Catalog { games: Game[]; recent: string[] }

function PlayGame({ game }: { game: Game }) {
  return <Link className="button primary" aria-label={'Play ' + game.name} streamName={game.name} href={'/stream/cloud/' + encodeURIComponent(game.id)}>Play</Link>
}

function GameDetails({ game, close }: { game: Game; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  const release = game.releaseDate?.slice(0, 10)
  const info = [
    ['Developer', game.developer], ['Publisher', game.publisher], ['Genre', game.categories?.join(', ')],
    ['Released', release], ['Supported controls', game.inputs?.map(mode => inputLabels[mode]).join(', ')],
  ].filter(([,value]) => value)
  return <dialog ref={dialog} aria-labelledby="game-title" className="game-details-modal" onClose={close}
    onClick={e => { if (e.target === dialog.current) dialog.current?.close() }}>
    <div>{(game.banner || game.cover) && <img alt="" src={game.banner || game.cover} />}
      <section><button className="details-close" onClick={() => dialog.current?.close()} aria-label="Close game details">×</button>
        <h2 id="game-title">{game.name}</h2><PlayGame game={game} />
        {game.description && <p>{game.description}</p>}
        <dl>{info.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </section>
    </div>
  </dialog>
}

const GameCard = memo(function GameCard({ game, open }: { game: Game; open: (game: Game) => void }) {
  const [failed, setFailed] = useState<string[]>([])
  const artwork = [game.banner, game.cover].find(url => url && !failed.includes(url))
  return <article className="card console-card cloud-game">
    <button className="game-tile" aria-label={'Game details for ' + game.name} aria-haspopup="dialog" onClick={() => open(game)}>
      {artwork && <img className="game-banner" src={artwork} alt="" decoding="async" loading="lazy" onLoad={event => event.currentTarget.classList.add('loaded')} onError={() => setFailed(previous => [...previous, artwork])} />}
    </button>
    <div className={'game-overlay' + (!artwork ? ' missing-art' : '')}><h2>{game.name}</h2><PlayGame game={game} /></div>
  </article>
})

const batchSize = 24
const collator = new Intl.Collator(undefined, { numeric: true })

function GameGrid({ games }: { games: Game[] }) {
  const [limit, setLimit] = useState(batchSize)
  const [selected, setSelected] = useState<Game>()
  const more = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const button = more.current
    if (!button || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect()
        setLimit(count => count + batchSize)
      }
    }, { rootMargin: '400px' })
    observer.observe(button)
    return () => observer.disconnect()
  }, [limit, games.length])
  return <>
    <div className="console-grid">{games.slice(0, limit).map(game => <GameCard key={game.id} game={game} open={setSelected} />)}</div>
    {selected && <GameDetails game={selected} close={() => setSelected(undefined)} />}
    {limit < games.length && <button className="more-games" ref={more} onClick={() => setLimit(n => n + batchSize)}>Show more games</button>}
  </>
}

export default function Cloud({ defaultSort }: { defaultSort: string }) {
  const [catalog, setCatalog] = useState<Catalog>()
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [recent, setRecent] = useState(false)
  const [genre, setGenre] = useState('')
  const [input, setInput] = useState('')
  const [sort, setSort] = useState(defaultSort)
  const query = fold(useDeferredValue(search))
  useEffect(() => {
    const abort = new AbortController()
    void api<Catalog>('/api/cloud/catalog', { signal: abort.signal }).then(data => {
      if (!abort.signal.aborted) startTransition(() => setCatalog(data))
    }).catch(reason => { if (!abort.signal.aborted) setError(message(reason)) })
    return () => abort.abort()
  }, [])
  const genres = useMemo(() => Array.from(new Set(catalog?.games.flatMap(game => game.categories ?? []))).sort(), [catalog])
  const searching = Boolean(query)
  const index = useMemo(() => new Map(searching ? catalog?.games.map(game => [game.id, {
    title: fold(game.name), text: fold([game.name, game.publisher, ...(game.categories ?? [])].join(' ')),
  }]) : []), [catalog, searching])
  const ranks = useMemo(() => new Map(catalog?.recent.map((id, i) => [id, i])), [catalog])
  const games = useMemo(() => {
    if (!catalog) return []
    if (!query && !genre && !input && !recent && sort === 'recommended') return catalog.games
    const words = query.split(' ').filter(Boolean)
    const matches = catalog.games.filter(game => (!genre || game.categories?.includes(genre)) &&
      (!input || game.inputs?.includes(input as InputMode)) && (!recent || ranks.has(game.id)) &&
      words.every(word => index.get(game.id)!.text.includes(word)))
    const relevance = (game: Game) => index.get(game.id)!.title === query ? 2 : Number(index.get(game.id)!.title.startsWith(query))
    return matches.sort((a, b) => {
      if (sort === 'az' || sort === 'za') return collator.compare(a.name, b.name) * (sort === 'az' ? 1 : -1)
      if (query && sort === 'recommended' && relevance(a) !== relevance(b)) return relevance(b) - relevance(a)
      if (recent || sort === 'last') return (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) || a.name.localeCompare(b.name)
      return 0
    })
  }, [catalog, query, genre, input, recent, sort, index, ranks])
  return <main className="workspace cloud-library" id="main">
    <div className="page-title"><h1>Cloud Gaming</h1></div>
    {error ? <section className="card" role="alert"><h2>Couldn’t load Cloud Gaming</h2><p>{error}</p></section> :
      !catalog ? <Loader>Loading your game catalog…</Loader> : <>
        <div className="cloud-filters"><label>Search games <input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label>Genre <select value={genre} onChange={e => setGenre(e.target.value)}><option value="">All genres</option>{genres.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>Input <select aria-label="Input" value={input} onChange={e => setInput(e.target.value)}><option value="">All inputs</option>{Object.entries(inputLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <label>Sort by <select value={sort} onChange={e => setSort(e.target.value)}><option value="recommended">Catalog order / relevance</option><option value="az">Name A–Z</option><option value="za">Name Z–A</option><option value="last">Last played</option></select></label>
          {(recent || !!catalog.recent.length) && <button aria-pressed={recent} onClick={() => setRecent(!recent)}>Recently played</button>}</div>
        <p className="library-count" role="status">{games.length} {games.length === 1 ? 'game' : 'games'}{(genre || input || recent || search) && <button onClick={() => { setGenre(''); setInput(''); setRecent(false); setSearch('') }}>Clear filters</button>}</p>
        {games.length ? <GameGrid key={JSON.stringify([query, genre, input, recent, sort])} games={games} /> : <p>{catalog.games.length ? 'No games match these filters.' : 'No cloud games are available on this account.'}</p>}
      </>}
  </main>
}
