import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';
import { SettingsPanelPanelProp } from './SettingsDialog';
import { TTSMediaMetadataMode } from '@/services/tts/types';
import { TTSUtils } from '@/services/tts/TTSUtils';
import { BoxedList, SettingsInput, SettingsRow, SettingsSelect } from './primitives';
import TTSHighlightStyleEditor, { TTSHighlightStyle } from './color/TTSHighlightStyleEditor';
import { CustomTTSSettings } from '@/types/settings';
import { eventDispatcher } from '@/utils/event';

const TTSPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getViewSettings } = useReaderStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [ttsMediaMetadata, setTtsMediaMetadata] = useState<TTSMediaMetadataMode>(
    viewSettings.ttsMediaMetadata ?? 'sentence',
  );
  const [ttsHighlightStyle, setTtsHighlightStyle] = useState(
    viewSettings.ttsHighlightOptions.style,
  );
  const [ttsHighlightColor, setTtsHighlightColor] = useState(
    viewSettings.ttsHighlightOptions.color,
  );
  const [customTtsHighlightColors, setCustomTtsHighlightColors] = useState(
    settings.globalReadSettings.customTtsHighlightColors || [],
  );

  const customTTS: CustomTTSSettings = useMemo(
    () => ({
      enabled: settings.globalReadSettings.customTTS?.enabled ?? false,
      endpoint: settings.globalReadSettings.customTTS?.endpoint ?? 'http://localhost:12236',
      apiKey: settings.globalReadSettings.customTTS?.apiKey ?? '',
      model: settings.globalReadSettings.customTTS?.model ?? 'tts-1',
    }),
    [settings.globalReadSettings.customTTS],
  );

  // TTS services available on this device. The Web Speech API is always
  // shown (the browser may have no voices — that's a per-runtime state,
  // not a static capability), and the Custom TTS entry mirrors the
  // `customTTS.enabled` toggle.
  const availableServices = useMemo(() => {
    const list: Array<{ id: string; label: string; description?: string }> = [
      { id: 'web-speech', label: _('Web Speech') },
      { id: 'edge-tts', label: _('Edge TTS') },
    ];
    if (appService?.isAndroidApp) {
      list.push({ id: 'native', label: _('System TTS') });
    }
    if (customTTS.enabled) {
      list.push({
        id: 'custom-tts',
        label: _('Custom TTS'),
        description: customTTS.endpoint,
      });
    }
    return list;
  }, [appService?.isAndroidApp, customTTS.enabled, customTTS.endpoint, _]);

  const preferredClient = TTSUtils.getPreferredClient() ?? 'web-speech';

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      ttsMediaMetadata: setTtsMediaMetadata as React.Dispatch<React.SetStateAction<string>>,
    });
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ttsMediaMetadata === viewSettings.ttsMediaMetadata) return;
    saveViewSettings(envConfig, bookKey, 'ttsMediaMetadata', ttsMediaMetadata, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsMediaMetadata]);

  const handleTTSStyleChange = (style: TTSHighlightStyle) => {
    setTtsHighlightStyle(style);
    saveViewSettings(envConfig, bookKey, 'ttsHighlightOptions', {
      style,
      color: ttsHighlightColor,
    });
  };

  const handleTTSColorChange = (color: string) => {
    setTtsHighlightColor(color);
    saveViewSettings(envConfig, bookKey, 'ttsHighlightOptions', {
      style: ttsHighlightStyle,
      color,
    });
  };

  const handleCustomTtsColorsChange = (colors: string[]) => {
    setCustomTtsHighlightColors(colors);
    settings.globalReadSettings.customTtsHighlightColors = colors;
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

  const handleMediaMetadataChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setTtsMediaMetadata(event.target.value as TTSMediaMetadataMode);
  };

  const handleDefaultServiceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    // Persist the choice immediately so the next reader init() picks it
    // up via TTSUtils.getPreferredClient().
    TTSUtils.setPreferredClient(next);
    // Live-update the active client when possible: signal any mounted
    // TTSController instances so they can switch without a page reload.
    eventDispatcher.dispatch('tts-preferred-client-changed', { client: next });
  };

  const persistCustomTTS = useCallback(
    (next: CustomTTSSettings) => {
      settings.globalReadSettings.customTTS = next;
      setSettings(settings);
      saveSettings(envConfig, settings);
    },
    [settings, envConfig, setSettings, saveSettings],
  );

  const handleCustomTTSEnabledChange = () => {
    const next: CustomTTSSettings = { ...customTTS, enabled: !customTTS.enabled };
    persistCustomTTS(next);
    eventDispatcher.dispatch('tts-custom-config-changed', { config: next });
  };

  const handleCustomTTSEndpointChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...customTTS, endpoint: event.target.value };
    persistCustomTTS(next);
    eventDispatcher.dispatch('tts-custom-config-changed', { config: next });
  };

  const handleCustomTTSModelChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...customTTS, model: event.target.value };
    persistCustomTTS(next);
    eventDispatcher.dispatch('tts-custom-config-changed', { config: next });
  };

  const handleCustomTTSApiKeyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...customTTS, apiKey: event.target.value };
    persistCustomTTS(next);
    eventDispatcher.dispatch('tts-custom-config-changed', { config: next });
  };

  return (
    <div className='my-4 w-full space-y-6'>
      <TTSHighlightStyleEditor
        style={ttsHighlightStyle}
        color={ttsHighlightColor}
        customColors={customTtsHighlightColors}
        onStyleChange={handleTTSStyleChange}
        onColorChange={handleTTSColorChange}
        onCustomColorsChange={handleCustomTtsColorsChange}
        data-setting-id='settings.tts.ttsHighlightStyle'
      />

      <BoxedList
        title={_('TTS Service')}
        description={_('Select which TTS engine speaks your books.')}
        data-setting-id='settings.tts.service'
      >
        <SettingsRow label={_('Available Services')}>
          <span className='text-base-content/70 settings-content pe-2 text-end text-sm'>
            {availableServices.map((s) => s.label).join(' · ')}
          </span>
        </SettingsRow>
        <SettingsRow
          label={_('Default Service')}
          description={_('Used when opening a new book. You can still pick a per-book voice.')}
        >
          <SettingsSelect
            value={preferredClient}
            onChange={handleDefaultServiceChange}
            ariaLabel={_('Default TTS Service')}
            options={availableServices.map((s) => ({ value: s.id, label: s.label }))}
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList
        title={_('Custom TTS')}
        description={_(
          'Connect an OpenAI-compatible TTS endpoint. It must expose GET /v1/audio/voices and POST /v1/audio/speech. When accessing Readest from another device on the LAN, set the endpoint to the host machine’s IP (e.g. http://192.168.1.10:12236) instead of localhost.',
        )}
        data-setting-id='settings.tts.custom'
      >
        <SettingsRow
          asLabel
          label={_('Enable Custom TTS')}
          description={_('Show Custom TTS as a selectable service.')}
        >
          <input
            type='checkbox'
            className='toggle'
            checked={customTTS.enabled}
            onChange={handleCustomTTSEnabledChange}
          />
        </SettingsRow>
        <SettingsRow label={_('Endpoint')} disabled={!customTTS.enabled}>
          <SettingsInput
            value={customTTS.endpoint}
            onChange={handleCustomTTSEndpointChange}
            disabled={!customTTS.enabled}
            placeholder='http://localhost:12236'
            aria-label={_('Custom TTS Endpoint')}
          />
        </SettingsRow>
        <SettingsRow label={_('Model')} disabled={!customTTS.enabled}>
          <SettingsInput
            value={customTTS.model}
            onChange={handleCustomTTSModelChange}
            disabled={!customTTS.enabled}
            placeholder='tts-1'
            aria-label={_('Custom TTS Model')}
          />
        </SettingsRow>
        <SettingsRow
          label={_('API Key')}
          description={_('Optional. Sent as a Bearer token when set.')}
          disabled={!customTTS.enabled}
        >
          <SettingsInput
            type='password'
            value={customTTS.apiKey}
            onChange={handleCustomTTSApiKeyChange}
            disabled={!customTTS.enabled}
            placeholder={_('sk-...')}
            aria-label={_('Custom TTS API Key')}
            autoComplete='off'
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList title={_('Media Info')} data-setting-id='settings.tts.mediaMetadata'>
        <SettingsRow label={_('Update Frequency')}>
          <SettingsSelect
            value={ttsMediaMetadata}
            onChange={handleMediaMetadataChange}
            ariaLabel={_('Update Frequency')}
            options={[
              { value: 'sentence', label: _('Every Sentence') },
              { value: 'paragraph', label: _('Every Paragraph') },
              { value: 'chapter', label: _('Every Chapter') },
            ]}
          />
        </SettingsRow>
      </BoxedList>
    </div>
  );
};

export default TTSPanel;
