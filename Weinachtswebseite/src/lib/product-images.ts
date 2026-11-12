const productImages: Record<string, string> = {
  'INZONE H9 II schwarz': '01-inzone-h9-ii.jpg',
  'Xiaomi Watch 2': '02-xiaomi-watch-2.jpg',
  'Monster Energy Ultra White Zero Sugar, 12x 500ml': '03-monster-ultra-white.jpg',
  'Govee Starlight Projector mit Nebula-Effekt': '04-govee-starlight.jpg',
  '5er Pack USB 3.0 Sticks 64GB': '05-usb-64gb-5pack.jpg',
  'ELEGOO ESP-32 Starter Kit': '06-elegoo-esp32.jpg',
  'Minecraft Dungeons 2': '07-minecraft-dungeons-2.jpg',
  'LEGO Game Boy - 72046': '08-lego-game-boy.jpg',
  'Steam Controller 2': '09-steam-controller-2.jpg',
  'Holy Sirup Starter Set mit Cola, Mango und Peach': '10-holy-syrup.jpg',
  'Inui Pocket Pro Powerbank 20.000mAh': '11-iniu-pocket-pro.jpg',
  'Very Cool X Minecraft Elytra Necklace': '12-elytra-pendant.jpg',
  'Grefay Fahrrad Handyhalterung': '13-grefay-bike-holder.jpg',
  'WMF Kult X Go Mixer': '14-wmf-kult-x.jpg',
}

export function getProductImage(title: string) {
  const file = productImages[title]
  return file ? `${import.meta.env.BASE_URL}products/${file}` : undefined
}
