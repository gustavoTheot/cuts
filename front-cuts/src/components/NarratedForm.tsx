import { useState } from "react";
import type { NarratedRequest } from "../api/client.ts";
import styles from "./NarratedForm.module.css";

interface Props {
  onSubmit: (request: NarratedRequest) => void;
  processing: boolean;
}

export function NarratedForm({ onSubmit, processing }: Props) {
  const [tema, setTema] = useState("");
  const [voz, setVoz] = useState<NarratedRequest["voz"]>("pt-BR-AntonioNeural");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tema.trim() || processing) return;
    onSubmit({ tema: tema.trim(), voz });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="narrated-tema">
          Tema ou roteiro
        </label>
        <textarea
          id="narrated-tema"
          className={styles.textarea}
          value={tema}
          onChange={(e) => setTema(e.target.value)}
          placeholder="Ex: Como a inteligência artificial está mudando o mercado de trabalho..."
          rows={5}
          disabled={processing}
          required
          minLength={3}
          maxLength={500}
        />
        <span className={styles.hint}>{tema.length}/500 caracteres</span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="narrated-voz">
          Voz narradora
        </label>
        <select
          id="narrated-voz"
          className={styles.select}
          value={voz}
          onChange={(e) => setVoz(e.target.value as NarratedRequest["voz"])}
          disabled={processing}
        >
          <option value="pt-BR-AntonioNeural">Antonio (masculina)</option>
          <option value="pt-BR-FranciscaNeural">Francisca (feminina)</option>
        </select>
      </div>

      <button
        type="submit"
        className={styles.btn}
        disabled={processing || tema.trim().length < 3}
      >
        {processing ? (
          <>
            <span className={styles.spin} />
            Gerando…
          </>
        ) : (
          "Gerar História"
        )}
      </button>
    </form>
  );
}
