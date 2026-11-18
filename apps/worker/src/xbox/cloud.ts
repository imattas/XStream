import { cloudInputs } from '../../../../input-modes';
import { HomeError, HomeService, object, validId } from './home';

// Cloud play sends this identifier in a JSON field. Console and session IDs
// have different constraints because the Worker also uses them in paths.
export function validTitleId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 512 && value.trim().length > 0 &&
    value !== '.' && value !== '..' && !/[\p{Cc}\p{Cs}]/u.test(value);
}

async function titles(service: HomeService, path: string) {
  const { results } = object(await service.call(path));
  if (!Array.isArray(results)) throw new HomeError(502, 'Xbox returned a catalog without a title list.');
  const games = results.flatMap(entry => {
    const { titleId, details } = object(entry);
    if (!validTitleId(titleId)) return [];
    const info = object(details);
    const productId = info.productId;
    const playable = info.hasEntitlement === true;
    return [{ id: titleId, playable, inputs: cloudInputs(info.supportedInputTypes), productId: validId(productId) ? productId : '' }];
  });
  if (results.length && !games.length) throw new HomeError(502, 'Xbox returned a title list without usable game IDs.');
  return games;
}

export async function requireTitle(service: HomeService, id: string) {
  const game = (await titles(service, '/v2/titles')).find(game => game.id === id);
  if (!game) {
    throw new HomeError(404, 'This game is unavailable in your Cloud Gaming catalog.');
  }
  if (!game.playable) throw new HomeError(403, 'Your account does not have entitlement to this game.');
  return game.inputs;
}

function cover(value: unknown) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value, 'https://store-images.s-microsoft.com');
    return url.origin === 'https://store-images.s-microsoft.com' ? url.href : '';
  } catch { return ''; }
}

export async function catalog(service: HomeService) {
  const games = (await titles(service, '/v2/titles')).filter(game => game.playable);
  const ids = [...new Set(games.map(game => game.productId).filter(Boolean))];
  const products = new Map<string, Record<string, unknown>>();
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  const history = titles(service, '/v2/titles/mru?mr=25').catch(() => []);
  await Promise.all(batches.map(async batch => {
    const response = await fetch('https://catalog.gamepass.com/v3/products?market=US&language=en-US&hydration=RemoteHighSapphire0', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', 'ms-cv': '0.0', 'calling-app-name': 'XStream', 'calling-app-version': '1.0' },
      body: JSON.stringify({ Products: batch })
    }).catch(() => null);
    const data = response?.ok ? object(await response.json().catch(() => null)).Products : null;
    for (const [key, item] of Object.entries(object(data))) {
      const product = object(item);
      if (!Array.isArray(data) && validId(key)) products.set(key, product);
      if (validId(product.StoreId)) products.set(product.StoreId, product);
      if (validTitleId(product.XCloudTitleId)) products.set(product.XCloudTitleId, product);
    }
  }));
  const playableIds = new Set(games.map(game => game.id));
  const recent = await history;
  return { recent: recent.map(game => game.id).filter(id => playableIds.has(id)), games: games.map(game => {
    const product = products.get(game.productId) ?? products.get(game.id) ?? {};
    return { id: game.id, inputs: game.inputs, playable: game.playable, name: typeof product.ProductTitle === 'string' ? product.ProductTitle : game.id,
      description: typeof product.ProductDescriptionShort === 'string' && product.ProductDescriptionShort || (typeof product.ProductDescription === 'string' ? product.ProductDescription.slice(0, 900) : ''),
      developer: typeof product.DeveloperName === 'string' ? product.DeveloperName : '',
      releaseDate: typeof product.OriginalReleaseDate === 'string' ? product.OriginalReleaseDate : '',
      publisher: typeof product.PublisherName === 'string' ? product.PublisherName : '',
      categories: Array.isArray(product.Categories) ? product.Categories.filter((item): item is string => typeof item === 'string') : [],
      cover: cover(object(product.Image_Tile).URL) || cover(object(product.Image_Poster).URL),
      banner: cover(object(product.Image_TitledHero).URL) || cover(object(product.Image_Hero).URL) };
  }) };
}
