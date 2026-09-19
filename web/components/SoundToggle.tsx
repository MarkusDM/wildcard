import { useEffect, useState } from 'react';
import { onSoundEnabledChange, playSound, readSoundEnabled, setSoundEnabled } from '../lib/sound';

export function SoundToggle() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(readSoundEnabled());
    return onSoundEnabledChange(setEnabled);
  }, []);

  const handleToggle = async () => {
    const nextValue = !enabled;
    setEnabled(nextValue);
    setSoundEnabled(nextValue);
    if (nextValue) {
      await playSound('ui-click');
    }
  };

  return (
    <button className="action-btn sound-toggle" type="button" onClick={() => void handleToggle()}>
      {enabled ? 'Sound On' : 'Sound Off'}
    </button>
  );
}
