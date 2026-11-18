import { supabase } from '@/components/refinance/supabaseClient';

async function call(body) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.functions.invoke('voice-intake', { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

// מעלה את ההקלטה לאחסון פרטי ומתמלל אותה בצד השרת (Deepgram)
export async function transcribeRecording(blob) {
  const type = blob.type || 'audio/webm';
  const ext = type.includes('mp4') ? '.mp4' : type.includes('ogg') ? '.ogg' : '.webm';
  const { path, token } = await call({ action: 'upload-ticket', ext });
  const { error } = await supabase.storage.from('voice-recordings').uploadToSignedUrl(path, token, blob, { contentType: type });
  if (error) throw error;
  const { transcript } = await call({ action: 'transcribe', path });
  return { path, transcript: transcript || '' };
}

// ממפה תמלול לשדות השאלון (AI) — מחזיר null לכל מה שלא נאמר במפורש
export const extractFields = ({ transcript, fieldKeys, known, prompt }) =>
  call({ action: 'extract', transcript, fieldKeys, known, prompt });

// לצוות בלבד: קישור זמני להאזנה להקלטה
export const getRecordingUrl = (path) => call({ action: 'read-recording', path });