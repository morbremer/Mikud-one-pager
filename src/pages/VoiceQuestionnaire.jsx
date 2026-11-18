import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { appClient } from '@/api/appClient';
import { transcribeRecording, extractFields } from '@/api/voiceIntake';
import { DEFAULT_RATES, calculateResults } from '@/components/mortgage/mortgageUtils';
import { mergeExtraction, mergeStory, toCalculatorInput } from '@/components/voice/fieldState';
import VoiceStepper from '@/components/voice/VoiceStepper';
import ConsentStep from '@/components/voice/ConsentStep';
import IntakeStep from '@/components/voice/IntakeStep';
import ReviewStep from '@/components/voice/ReviewStep';
import CaseStep from '@/components/voice/CaseStep';

// מסלול קולי נפרד לשאלון ההיתכנות על פי הצהרה. אינו נוגע בשאלון הרגיל או במחזור משכנתא.
export default function VoiceQuestionnaire() {
  const [stage, setStage] = useState('consent');
  const [fields, setFields] = useState({});
  const [story, setStory] = useState(null);
  const [followUps, setFollowUps] = useState([]);
  const [turns, setTurns] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [rates, setRates] = useState(DEFAULT_RATES);
  const [leadId, setLeadId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [isPurchased, setIsPurchased] = useState(false);

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [stage]);

  useEffect(() => {
    appClient.functions.invoke('getBankOfIsraelRates')
      .then(r => { if (r.data?.success && r.data?.rates) setRates(r.data.rates); })
      .catch(err => console.error('rates', err));
  }, []);

  const known = () => Object.fromEntries(Object.entries(fields).map(([k, s]) => [k, s.value]));

  const processAudio = async (blob, { fieldKeys, source, questionKey, prompt }) => {
    const { path, transcript } = await transcribeRecording(blob);
    setRecordings(prev => [...prev, { path, kind: source, questionKey, prompt: prompt || null, transcript, createdAt: new Date().toISOString() }]);
    if (!transcript.trim()) return transcript;
    const extracted = await extractFields({ transcript, fieldKeys, known: known(), prompt });
    setFields(prev => mergeExtraction(prev, extracted.fields, source));
    if (source === 'conversation') {
      setStory(prev => mergeStory(prev, extracted.story));
      setFollowUps(extracted.followUpQuestions || []);
      setTurns(prev => [...prev, { prompt, transcript }]);
    }
    return transcript;
  };

  const onType = (key, value) => setFields(prev => ({ ...prev, [key]: { ...prev[key], value, source: 'typed', status: 'draft', note: '' } }));

  const ALL_PURPOSE_RATES = useMemo(() => ({
    FIXED_UNLINKED: (rates.FIXED_UNLINKED || 0.0470) + 0.004,
    VAR_LINKED: (rates.VAR_LINKED || 0.0315) + 0.003,
    PRIME_CALC: rates.PRIME_CALC || 0.0490,
  }), [rates]);

  const { formData, borrowers } = useMemo(() => toCalculatorInput(fields), [fields]);
  const maxTerm = Math.min(30, Math.max(1, 85 - (Number(formData.age) || 35)));
  const results = useMemo(
    () => calculateResults({ formData, borrowers, maxTerm, rates, ALL_PURPOSE_RATES }),
    [formData, borrowers, maxTerm, rates, ALL_PURPOSE_RATES],
  );

  const confirm = async () => {
    setSaving(true);
    setSaveError(null);
    const confirmed = Object.fromEntries(Object.entries(fields).map(([k, s]) => [k, { ...s, status: 'confirmed' }]));
    const num = (v) => (v ? Number(v) : undefined);
    const payload = {
      fullName: `${formData.firstName} ${formData.lastName}`.trim(), phone: formData.phone, email: formData.email,
      idNumber: formData.idNumber, birthDate: formData.birthDate, age: num(formData.age),
      maritalStatus: borrowers[0].maritalStatus, mortgageType: formData.mortgageType,
      propertyPrice: num(formData.propertyPrice), equity: num(formData.equity), loanAmount: results.loanAmount,
      loanDuration: num(formData.loanDuration), monthlyDebts: num(formData.monthlyDebts) || 0,
      monthlyOverdraft: num(formData.monthlyOverdraft) || 0, netIncome: results.totalIncome,
      ltv: results.ltv, score: results.score, isPurchased: false, status: 'new',
      intakeChannel: 'voice',
      voiceIntake: { fields: confirmed, story, recordings, turns, confirmedAt: new Date().toISOString() },
    };
    try {
      const lead = leadId ? await appClient.entities.Lead.update(leadId, payload) : await appClient.entities.Lead.create(payload);
      setLeadId(lead.id);
      setFields(confirmed);
      setStage('case');
    } catch (err) {
      console.error(err);
      setSaveError('שמירת התיק נכשלה. נסו שוב.');
    } finally {
      setSaving(false);
    }
  };

  const intakeProps = { fields, story, followUps, turns, processAudio, onType, onFinish: () => setStage('review') };

  return (
    <div className="min-h-screen bg-white text-right font-sans" dir="rtl">
      <header className="max-w-5xl mx-auto px-4 py-6 flex items-center justify-between">
        <Link to="/" className="text-[#0C084A] font-black text-lg">בדוק</Link>
        <Link to="/" className="text-xs font-bold text-mist-500 hover:text-[#0153F4]">מעדיפים להקליד? לשאלון הרגיל</Link>
      </header>
      <main className="max-w-3xl mx-auto px-4 pb-24 pt-6">
        <VoiceStepper stage={stage} />
        {stage === 'consent' && <ConsentStep onAccept={() => setStage('intake')} />}
        {stage === 'intake' && <IntakeStep {...intakeProps} />}
        {stage === 'review' && (
          <ReviewStep fields={fields} onType={onType} story={story} onBack={() => setStage('intake')} onConfirm={confirm} saving={saving} error={saveError} />
        )}
        {stage === 'case' && (
          <CaseStep results={results} firstName={formData.firstName} story={story} leadId={leadId} isPurchased={isPurchased} onPaid={() => setIsPurchased(true)} />
        )}
      </main>
    </div>
  );
}