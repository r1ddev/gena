"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, ImagePlus, X } from "lucide-react";
import { productImageError, PRODUCT_IMAGE_TYPES } from "@/domain/product-image-constants";

export function ProductImageInput({ id, value, onChange, existingImageUrl, onRemoveExisting }: { id: string; value: File | null; onChange: (file: File | null) => void; existingImageUrl?: string; onRemoveExisting?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!value) { setPreview(""); return; }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  function acceptImage(file: File) {
    const issue = productImageError(file.type, file.size);
    setError(issue ?? "");
    if (!issue) onChange(file);
  }

  function pasteImage(event: React.ClipboardEvent<HTMLDivElement>) {
    const image = Array.from(event.clipboardData.items).find((item) => item.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    const file = image.getAsFile();
    if (file) acceptImage(file);
  }

  function clearImage() {
    onChange(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  const showExistingImage = Boolean(existingImageUrl && !value);
  return <div className="field full product-image-field">
    <label htmlFor={id}>Изображение товара</label>
    <input
      ref={inputRef}
      id={id}
      type="file"
      accept={PRODUCT_IMAGE_TYPES.join(",")}
      className="product-image-file-input"
      onChange={(event) => { const file = event.target.files?.[0]; if (file) acceptImage(file); }}
    />
    <div className="product-image-controls">
      {(preview || showExistingImage) && <img className="product-image-preview" src={preview || existingImageUrl} alt={preview ? "Предпросмотр изображения товара" : "Текущее изображение товара"} />}
      <div className="product-image-actions">
        <label htmlFor={id} className="button secondary small"><ImagePlus size={14} />{showExistingImage ? "Заменить изображение" : "Выбрать изображение"}</label>
        <div className="product-image-paste" tabIndex={0} role="group" aria-label="Вставить изображение из буфера обмена" onPaste={pasteImage}>
          <ClipboardPaste size={14} />Нажмите сюда и вставьте изображение: ⌘V или Ctrl+V
        </div>
        {value && <button type="button" className="button secondary small" onClick={clearImage}><X size={13} />Убрать изображение</button>}
        {showExistingImage && onRemoveExisting && <button type="button" className="button secondary small" onClick={onRemoveExisting}><X size={13} />Удалить изображение</button>}
        <span className="small-note">Необязательно. JPG, PNG или WebP, до 5 МБ.</span>
      </div>
    </div>
    {error && <span className="product-image-error" role="alert">{error}</span>}
  </div>;
}
