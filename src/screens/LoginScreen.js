/**
 * src/screens/LoginScreen.js
 * SMS OTP sign-in — two steps, one card.
 *
 *   1. 'phone'  enter a mobile number → POST /api/auth/otp/request
 *   2. 'code'   enter the 6 digits    → POST /api/auth/otp/verify
 *
 * There is no role selection any more. Role comes from the employee record the
 * phone number belongs to, so it is decided entirely on the server.
 *
 * Two deliberate behaviours worth knowing when reading this:
 *
 *  - Step 1 advances to step 2 even for a number that is not registered. The
 *    server returns an identical response either way so the endpoint cannot be
 *    used to test whether a number belongs to staff. The user finds out at the
 *    verify step, where the message is the generic "invalid or expired code".
 *
 *  - Server error `code`s are mapped to translated strings, falling back to the
 *    server's own message. That keeps Telugu working for the cases we know about
 *    without swallowing a message we have not accounted for.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  SafeAreaView, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, Dimensions,
} from 'react-native';
import { useAppContext } from '../context/AppContext';
import { useI18n } from '../i18n';
import { MaterialIcons } from '../components/shared/Icon';
import { Colors, Radii, Shadow } from '../theme/colors';

const { width } = Dimensions.get('window');

const CODE_LENGTH = 6;

/**
 * Server error code → i18n key. Anything absent falls back to the message the
 * server sent, so an unmapped code still shows something useful.
 */
const ERROR_KEYS = {
  PHONE_INVALID:         'login.phoneInvalid',
  PHONE_NOT_REGISTERED:  'login.phoneNotRegistered',
  OTP_REQUIRED:          'login.codeRequired',
  OTP_INVALID:           'login.codeInvalid',
  OTP_TOO_MANY_ATTEMPTS: 'login.codeTooManyAttempts',
  OTP_COOLDOWN:          'login.codeCooldown',
  OTP_RATE_LIMITED:      'login.codeRateLimited',
  SMS_FAILED:            'login.smsFailed',
  ACCOUNT_INACTIVE:      'login.accountInactive',
  NETWORK_ERROR:         'login.networkError',
};

// ── Language Toggle ───────────────────────────────────────────────────────────
function LanguageToggle() {
  const { lang, setLang, LANGUAGES } = useI18n();
  return (
    <View style={ls.wrapper}>
      {LANGUAGES.map((l) => (
        <TouchableOpacity
          key={l.code}
          style={[ls.btn, lang === l.code && ls.btnActive]}
          onPress={() => setLang(l.code)}
          accessibilityRole="radio"
          accessibilityState={{ selected: lang === l.code }}
        >
          <Text style={[ls.btnText, lang === l.code && ls.btnTextActive]}>
            {l.nativeLabel}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
const ls = StyleSheet.create({
  wrapper: { flexDirection: 'row', marginBottom: 24, borderRadius: Radii.full, overflow: 'hidden', borderWidth: 1.5, borderColor: Colors.border },
  btn: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: Colors.surfaceAlt },
  btnActive: { backgroundColor: Colors.primary },
  btnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  btnTextActive: { color: Colors.white, fontWeight: '700' },
});

// ── Sign-in card ──────────────────────────────────────────────────────────────
function SignInCard() {
  const { requestOtp, verifyOtp, sessionEndedReason, acknowledgeSessionEnded } = useAppContext();
  const { t } = useI18n();

  const [step, setStep]           = useState('phone');
  const [phone, setPhone]         = useState('');
  const [code, setCode]           = useState('');
  const [maskedPhone, setMasked]  = useState('');
  const [devCode, setDevCode]     = useState('');
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState('');
  const [cooldown, setCooldown]   = useState(0);

  const codeInputRef = useRef(null);

  /**
   * Turns an ApiError into a displayable string, preferring a translated message
   * for codes we know about.
   */
  const messageFor = useCallback((err) => {
    const key = ERROR_KEYS[err?.code];
    if (key) {
      const translated = t(key, { seconds: err?.details?.retryAfterSeconds ?? 0 });
      // t() returns the key itself when nothing matches; don't show that.
      if (translated !== key) return translated;
    }
    return err?.message || t('login.genericError');
  }, [t]);

  // Resend cooldown ticker. The server enforces the real limit; this only stops
  // the user hammering a button that would be rejected anyway.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setCooldown((seconds) => (seconds <= 1 ? 0 : seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleSendCode() {
    const trimmed = phone.trim();
    if (!trimmed) {
      setError(t('login.phoneRequired'));
      return;
    }

    setError('');
    setBusy(true);
    try {
      const data = await requestOtp(trimmed);

      setMasked(data.phone || trimmed);
      setCooldown(data.resendAfterSeconds || 0);
      // Only ever populated while the backend runs SMS_PROVIDER=console.
      setDevCode(data.devCode || '');
      setCode('');
      setStep('code');
      // Focus lands on the code field so the user can type straight away.
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== CODE_LENGTH) {
      setError(t('login.codeRequired'));
      return;
    }

    setError('');
    setBusy(true);
    try {
      // On success the provider swaps this screen out, so there is nothing to do
      // here afterwards.
      await verifyOtp(phone.trim(), digits);
      acknowledgeSessionEnded();
    } catch (err) {
      setError(messageFor(err));
      setCode('');
      codeInputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function handleChangeNumber() {
    setStep('phone');
    setCode('');
    setDevCode('');
    setError('');
  }

  const sessionNotice = sessionEndedReason ? t('login.sessionEnded') : '';

  return (
    <View style={card.wrapper}>
      {/* Why the user is back at the login screen, when it wasn't their choice */}
      {sessionNotice && step === 'phone' ? (
        <View style={card.noticeBox}>
          <MaterialIcons name="info" size={16} color={Colors.warningText} />
          <Text style={card.noticeText}>{sessionNotice}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={card.errorBox}>
          <Text style={card.errorText}>{error}</Text>
        </View>
      ) : null}

      {step === 'phone' ? (
        <>
          <Text style={card.stepLabel}>{t('login.phoneLabel')}</Text>
          <View style={card.inputBox}>
            <MaterialIcons name="phone" size={18} color={Colors.textMuted} style={card.inputIcon} />
            <TextInput
              style={card.inputText}
              value={phone}
              onChangeText={(v) => { setPhone(v); setError(''); }}
              placeholder={t('login.phonePlaceholder')}
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              autoCorrect={false}
              returnKeyType="send"
              onSubmitEditing={handleSendCode}
              editable={!busy}
              accessibilityLabel={t('login.phoneLabel')}
            />
          </View>
          <Text style={card.helpText}>{t('login.phoneHelp')}</Text>

          <TouchableOpacity
            style={[card.primaryBtn, busy && card.btnBusy]}
            onPress={handleSendCode}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('login.sendCode')}
          >
            {busy ? <ActivityIndicator color={Colors.white} />
                  : <Text style={card.primaryBtnText}>{t('login.sendCode')}</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={card.stepLabel}>{t('login.codeLabel')}</Text>
          <Text style={card.sentTo}>{t('login.codeSentTo', { phone: maskedPhone })}</Text>

          <TextInput
            ref={codeInputRef}
            style={card.codeInput}
            value={code}
            onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, CODE_LENGTH)); setError(''); }}
            placeholder="––––––"
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
            // Lets iOS and Android offer the code straight from the SMS.
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={CODE_LENGTH}
            returnKeyType="done"
            onSubmitEditing={handleVerify}
            editable={!busy}
            accessibilityLabel={t('login.codeLabel')}
          />

          {devCode ? (
            <View style={card.devBox}>
              <MaterialIcons name="build" size={15} color={Colors.pendingText} />
              <Text style={card.devText}>{t('login.devCodeNotice', { code: devCode })}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[card.primaryBtn, busy && card.btnBusy]}
            onPress={handleVerify}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('login.verify')}
          >
            {busy ? <ActivityIndicator color={Colors.white} />
                  : <Text style={card.primaryBtnText}>{t('login.verify')}</Text>}
          </TouchableOpacity>

          <View style={card.footerRow}>
            <TouchableOpacity
              onPress={handleChangeNumber}
              disabled={busy}
              accessibilityRole="button"
            >
              <Text style={card.linkText}>{t('login.changeNumber')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSendCode}
              disabled={busy || cooldown > 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || cooldown > 0 }}
            >
              <Text style={[card.linkText, (busy || cooldown > 0) && card.linkDisabled]}>
                {cooldown > 0 ? t('login.resendIn', { seconds: cooldown }) : t('login.resend')}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const card = StyleSheet.create({
  wrapper: {
    width: '100%', backgroundColor: Colors.surface, borderRadius: Radii.lg,
    padding: 20, borderLeftWidth: 4, borderLeftColor: Colors.primary, ...Shadow.card,
  },
  stepLabel: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 8 },
  sentTo: { fontSize: 13, color: Colors.textSecondary, marginBottom: 14 },
  helpText: { fontSize: 12, color: Colors.textMuted, marginTop: 8, marginBottom: 16 },
  inputBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceAlt,
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radii.md,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 10,
  },
  inputIcon: { marginRight: 10 },
  inputText: { flex: 1, fontSize: 15, color: Colors.textPrimary },
  codeInput: {
    backgroundColor: Colors.surfaceAlt, borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: Radii.md, paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 26, fontWeight: '700', letterSpacing: 10, textAlign: 'center',
    color: Colors.textPrimary, marginBottom: 16,
  },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radii.md, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', ...Shadow.fab,
  },
  btnBusy: { opacity: 0.7 },
  primaryBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  linkText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  linkDisabled: { color: Colors.textMuted },
  errorBox: {
    backgroundColor: Colors.dangerLight, borderRadius: Radii.sm, padding: 10,
    marginBottom: 14, borderLeftWidth: 3, borderLeftColor: Colors.danger,
  },
  errorText: { fontSize: 13, color: Colors.danger, fontWeight: '500' },
  noticeBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.warningBg,
    borderRadius: Radii.sm, padding: 10, marginBottom: 14,
  },
  noticeText: { flex: 1, fontSize: 12, color: Colors.warningText, marginLeft: 8 },
  devBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.pendingBg,
    borderRadius: Radii.sm, padding: 10, marginBottom: 16,
  },
  devText: { flex: 1, fontSize: 12, color: Colors.pendingText, marginLeft: 8, fontWeight: '600' },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const { t } = useI18n();

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Logo */}
          <View style={styles.logoWrap}>
            <View style={styles.logoBox}>
              <Text style={styles.logoLetter}>F</Text>
            </View>
          </View>

          {/* Title */}
          <Text style={styles.appName}>{t('login.title')}</Text>
          <Text style={styles.tagline}>{t('login.subtitle')}</Text>

          {/* Language toggle */}
          <LanguageToggle />

          <SignInCard />

          <Text style={styles.secureNote}>{t('login.secureNote')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const CARD_WIDTH = Math.min(width - 40, 420);
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 20, maxWidth: CARD_WIDTH, alignSelf: 'center', width: '100%' },
  logoWrap: { marginBottom: 16 },
  logoBox: { width: 56, height: 56, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  logoLetter: { fontSize: 28, fontWeight: '900', color: Colors.white, lineHeight: 34 },
  appName: { fontSize: 22, fontWeight: '800', color: Colors.primary, letterSpacing: -0.4, marginBottom: 4 },
  tagline: { fontSize: 13, color: Colors.textSecondary, marginBottom: 20 },
  secureNote: { textAlign: 'center', fontSize: 11, color: Colors.textMuted, marginTop: 16 },
});
