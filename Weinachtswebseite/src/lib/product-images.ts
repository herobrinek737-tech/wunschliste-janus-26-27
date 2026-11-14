const shopImageKeys: Array<[string, string]> = [
  ['inzone-h9-ii', '01-inzone-h9-ii.jpg'],
  ['xiaomi-watch-2', '02-xiaomi-watch-2.jpg'],
  ['monster-ultra-white-zero-sugar', '03-monster-ultra-white.jpg'],
  ['govee-star-light-projector-nebula', '04-govee-starlight.jpg'],
  ['B09XWVVWMS|4djEjGP|4djEGP', '05-usb-64gb-5pack.jpg'],
  ['B0FVWW7MD4|4rJ3nNa', '06-elegoo-esp32.jpg'],
  ['minecraft-dungeons-ii', '07-minecraft-dungeons-2.jpg'],
  ['72046', '08-lego-game-boy.jpg'],
  ['steamcontroller2', '09-steam-controller-2.jpg'],
  ['syrup-set-builder', '10-holy-syrup.jpg'],
  ['B0DCYR5VNR', '11-iniu-pocket-pro.jpg'],
  ['the-elytra-pendant', '12-elytra-pendant.jpg'],
  ['B07GQLYPZZ|Grefay.Fahrrad.Handyhalterung', '13-grefay-bike-holder.jpg'],
  ['B0FSL2832J|WMF.Kult.X.Go.Mixer', '14-wmf-kult-x.jpg'],
]

const shopImages = shopImageKeys.map(([key, file]) => [new RegExp(key, 'i'), file] as const)

const marleneImages = [
  [/\/3565144164-154-6306(?:[/?#]|$)/i, 'reitpoloshirt.webp'],
  [/\/rucksack-21-l-5gs9z5(?:[/?#]|$)/i, 'nike-rucksack.webp'],
  [/PPN3050033(?:[/?#]|$)/i, 'air-up-click.webp'],
  [/[?&]ProductId=341009955(?:[&#]|$)/i, 'rollregal.webp'],
  [/\/B07M91H7XB(?:[/?#]|$)/i, 'auxmir-aufsteller.webp'],
  [/\/B0FD34T1NB(?:[/?#]|$)/i, 'schubladen-organizer.webp'],
  [/\/B0DG4Y9R97(?:[/?#]|$)/i, 'waeschekorb.webp'],
  [/\/B0DRYWT1WM(?:[/?#]|$)/i, 'nageltips.webp'],
  [/\/19975073268(?:[/?#]|$)/i, 'apfel-squishy.webp'],
] as const

export function getProductImage(shopUrl: string, list: 'janus' | 'marlene') {
  const images = list === 'marlene' ? marleneImages : shopImages
  const file = images.find(([key]) => key.test(shopUrl))?.[1]
  if (file && list === 'marlene') return `${import.meta.env.BASE_URL}products/marlene/${file}`
  return file ? `${import.meta.env.BASE_URL}products/${file}` : undefined
}
