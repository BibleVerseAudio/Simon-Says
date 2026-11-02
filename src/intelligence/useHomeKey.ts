/**
 * Homepage API-key panel state: read/save/clear the shared Meta key,
 * display masked status only. No key is ever rendered back in full.
 */
import { useEffect, useState } from 'react';
import { loadSamKey, saveSamKey } from '../sam/verifier';

export function useHomeKey() {
  const [saved, setSaved] = useState(false);
  const [masked, setMasked] = useState('');
  const [input, setInput] = useState('');
  const refresh = async () => {
    const k = await loadSamKey().catch(() => '');
    setSaved(!!k);
    setMasked(k ? `••••${k.slice(-4)}` : '');
  };
  useEffect(() => {
    refresh();
  }, []);
  const save = async (raw: string) => {
    await saveSamKey(raw.trim());
    setInput('');
    await refresh();
  };
  const clear = async () => {
    await saveSamKey('');
    setInput('');
    await refresh();
  };
  return { saved, masked, input, setInput, save, clear, refresh };
}
