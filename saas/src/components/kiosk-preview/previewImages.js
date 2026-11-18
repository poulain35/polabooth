/** Charge une image (PNG de l'export, photo d'exemple, photo de l'utilisateur en URL locale). */
export function loadPreviewImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image illisible : ${String(src).slice(0, 60)}`));
    img.src = src;
  });
}
