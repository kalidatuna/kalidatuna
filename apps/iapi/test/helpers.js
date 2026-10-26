// Small synthetic snapshot shared by the tests. Prices are in tetri.
export const venue = (slug, brand, city, lat, lon, extra = {}) => ({
  slug,
  name: `${slug} branch`,
  brand,
  city,
  address: `${slug} street`,
  lat,
  lon,
  rating: 9,
  ratingCount: 100,
  online: true,
  deliveryPrice: 0,
  estimate: '15-25',
  promotions: [],
  url: `https://wolt.com/en/geo/${city}/restaurant/${slug}`,
  ...extra,
});

export const product = (key, kind, name, extra = {}) => ({
  key,
  brand: key.split(':')[0],
  name,
  nameKa: `${name} ka`,
  category: '',
  kind,
  description: '',
  image: null,
  alcohol: false,
  ...extra,
});

export function sampleSnapshot(generatedAt = '2026-10-26T10:00:00.000Z') {
  return {
    generatedAt,
    source: 'test',
    cities: [
      { slug: 'tbilisi', name: 'Tbilisi', nameKa: 'თბილისი', lat: 41.7151, lon: 44.8271 },
      { slug: 'batumi', name: 'Batumi', nameKa: 'ბათუმი', lat: 41.6168, lon: 41.6367 },
    ],
    brands: [
      { slug: 'mcdonalds', name: "McDonald's", color: '#ffc72c' },
      { slug: 'wendys', name: "Wendy's", color: '#e2203d' },
    ],
    venues: [
      venue('mcd-vake', 'mcdonalds', 'tbilisi', 41.71, 44.76, { promotions: ['12 GEL off (spend 30 GEL)'] }),
      venue('mcd-center', 'mcdonalds', 'tbilisi', 41.69, 44.80),
      venue('wendys-dolidze', 'wendys', 'tbilisi', 41.72, 44.75),
      venue('mcd-batumi', 'mcdonalds', 'batumi', 41.62, 41.64),
    ],
    products: [
      product('mcdonalds:cheeseburger', 'main', 'Cheeseburger'),
      product('mcdonalds:big-mac', 'main', 'Big Mac'),
      product('mcdonalds:fries', 'side', 'French fries'),
      product('mcdonalds:cola', 'drink', 'Coca-Cola'),
      product('mcdonalds:ketchup', 'extra', 'Ketchup'),
      product('mcdonalds:mcmenu', 'combo', 'Big Mac McMenu'),
      product('wendys:burger', 'main', 'Wendys Burger'),
      product('wendys:cola', 'drink', 'Coca-Cola'),
      product('wendys:beer', 'drink', 'Beer', { alcohol: true }),
    ],
    prices: [
      { venue: 'mcd-vake', product: 'mcdonalds:cheeseburger', price: 450, originalPrice: 600 },
      { venue: 'mcd-center', product: 'mcdonalds:cheeseburger', price: 500, originalPrice: null },
      { venue: 'mcd-vake', product: 'mcdonalds:big-mac', price: 1100, originalPrice: null },
      { venue: 'mcd-center', product: 'mcdonalds:big-mac', price: 1000, originalPrice: null },
      { venue: 'mcd-vake', product: 'mcdonalds:fries', price: 445, originalPrice: null },
      { venue: 'mcd-center', product: 'mcdonalds:fries', price: 445, originalPrice: null },
      { venue: 'mcd-vake', product: 'mcdonalds:cola', price: 490, originalPrice: null },
      { venue: 'mcd-center', product: 'mcdonalds:cola', price: 480, originalPrice: null },
      { venue: 'mcd-vake', product: 'mcdonalds:ketchup', price: 185, originalPrice: null },
      { venue: 'mcd-vake', product: 'mcdonalds:mcmenu', price: 1795, originalPrice: null },
      { venue: 'wendys-dolidze', product: 'wendys:burger', price: 1325, originalPrice: null },
      { venue: 'wendys-dolidze', product: 'wendys:cola', price: 495, originalPrice: null },
      { venue: 'wendys-dolidze', product: 'wendys:beer', price: 300, originalPrice: null },
      { venue: 'mcd-batumi', product: 'mcdonalds:cheeseburger', price: 520, originalPrice: null },
    ],
    errors: [],
  };
}
