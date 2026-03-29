/**
 * useVoiceCall — WebRTC voice call between the King commander and other piece players.
 *
 * Rules:
 *  - Only the King player can INITIATE a call.
 *  - The call auto-starts when King opens a piece chat with a human-controlled type.
 *  - The target player auto-answers (no manual accept).
 *  - Call ends when King closes chat, selects a different type, or the piece is captured.
 *  - Non-King players auto-answer any incoming offer from the King.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import mpService from '../services/multiplayerService';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function useVoiceCall({ myPieceType, session }) {
  const [inCall,       setInCall]       = useState(false);
  const [callWithType, setCallWithType] = useState(null);

  const pcRef     = useRef(null);   // RTCPeerConnection
  const streamRef = useRef(null);   // local MediaStream
  const audioRef  = useRef(null);   // <audio> element ref for remote stream

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  function cleanup() {
    if (pcRef.current)  { pcRef.current.close(); pcRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioRef.current) audioRef.current.srcObject = null;
    setInCall(false);
    setCallWithType(null);
  }

  // ── King: initiate call ──────────────────────────────────────────────────────

  const startCall = useCallback(async (targetPieceType) => {
    if (myPieceType !== 'K') return;

    // Verify target is a human player in the session (not Claude)
    const targetPlayer = session?.players?.find(p => p.pieceType === targetPieceType);
    if (!targetPlayer) return;

    cleanup();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) mpService.sendWebRTCIce(targetPieceType, e.candidate);
      };

      pc.ontrack = (e) => {
        if (audioRef.current && e.streams[0]) {
          audioRef.current.srcObject = e.streams[0];
          audioRef.current.play().catch(() => {});
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      mpService.sendWebRTCOffer(targetPieceType, offer);

      setInCall(true);
      setCallWithType(targetPieceType);
    } catch (err) {
      console.error('[VoiceCall] Failed to start call:', err);
      cleanup();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPieceType, session]);

  // ── King: end call ───────────────────────────────────────────────────────────

  const endCall = useCallback((targetPieceType) => {
    if (targetPieceType) mpService.sendCallEnd(targetPieceType);
    cleanup();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Non-King: listen for incoming offers & auto-answer ───────────────────────

  useEffect(() => {
    if (myPieceType === 'K') return;

    const unsubs = [
      mpService.on('WEBRTC_OFFER', async (msg) => {
        cleanup();
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          streamRef.current = stream;

          const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
          pcRef.current = pc;

          stream.getTracks().forEach(track => pc.addTrack(track, stream));

          // ICE → send back to King (targetPieceType = null means "reply to King")
          pc.onicecandidate = (e) => {
            if (e.candidate) mpService.sendWebRTCIce(null, e.candidate);
          };

          pc.ontrack = (e) => {
            if (audioRef.current && e.streams[0]) {
              audioRef.current.srcObject = e.streams[0];
              audioRef.current.play().catch(() => {});
            }
          };

          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          mpService.sendWebRTCAnswer(answer);

          setInCall(true);
          setCallWithType('K');
        } catch (err) {
          console.error('[VoiceCall] Failed to answer call:', err);
          cleanup();
        }
      }),

      mpService.on('WEBRTC_ICE', async (msg) => {
        if (pcRef.current && msg.candidate) {
          try { await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
        }
      }),

      mpService.on('CALL_END', () => {
        cleanup();
      }),
    ];

    return () => unsubs.forEach(fn => fn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPieceType]);

  // ── King: listen for answer + ICE from target ────────────────────────────────

  useEffect(() => {
    if (myPieceType !== 'K') return;

    const unsubs = [
      mpService.on('WEBRTC_ANSWER', async (msg) => {
        if (pcRef.current) {
          try {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          } catch (err) {
            console.error('[VoiceCall] Failed to set remote description:', err);
          }
        }
      }),

      mpService.on('WEBRTC_ICE', async (msg) => {
        if (pcRef.current && msg.candidate) {
          try { await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
        }
      }),

      mpService.on('CALL_END', () => {
        cleanup();
      }),
    ];

    return () => unsubs.forEach(fn => fn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPieceType]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => cleanup(), []);

  return { inCall, callWithType, startCall, endCall, audioRef };
}
