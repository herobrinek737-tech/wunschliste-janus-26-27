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

export function getProductImage(shopUrl: string) {
  const file = shopImages.find(([key]) => key.test(shopUrl))?.[1]
  return file ? `${import.meta.env.BASE_URL}products/${file}` : undefined
}
