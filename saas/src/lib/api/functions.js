// Appels aux edge functions avec le client partagé (LAB-420) : passer par callFunction, ou par
// requestFunction / fetchFunction quand le statut ou la réponse brute sont lus à part.
import { createFunctionCaller } from '../functionCall.js';
import { FUNCTIONS_URL, supabaseAnon } from './client.js';
import { currentSession } from './session.js';

export const { callFunction, requestFunction, fetchFunction } = createFunctionCaller({
  baseUrl: FUNCTIONS_URL, anonKey: supabaseAnon, getSession: currentSession,
});
