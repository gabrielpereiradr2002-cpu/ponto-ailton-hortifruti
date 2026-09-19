'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type TimeEntry = {
  id: string;
  work_date: string;
  kind: 'entrada' | 'saida_intervalo' | 'retorno_intervalo' | 'saida';
  created_at: string;
  suspicious?: boolean;
  distance_m?: number;
  accuracy_m?: number;
};

type SavedPosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

type PunchKind =
  | 'entrada'
  | 'saida_intervalo'
  | 'retorno_intervalo'
  | 'saida';

export default function Dashboard() {
  const [msg, setMsg] = useState('Pronto para registrar.');
  const [rows, setRows] = useState<TimeEntry[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const [position, setPosition] =
    useState<SavedPosition | null>(null);

  const [pendingKind, setPendingKind] =
    useState<PunchKind | null>(null);

  const [waitingSelfie, setWaitingSelfie] =
    useState(false);

  const [selfieName, setSelfieName] =
    useState('');

  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  async function load() {
    const s = supabase();

    const {
      data: { user },
    } = await s.auth.getUser();

    if (!user) {
      location.href = '/';
      return;
    }

    const [{ data: profile }, { data: entries }] =
      await Promise.all([
        s
          .from('profiles')
          .select('name')
          .eq('id', user.id)
          .single(),

        s
          .from('time_entries')
          .select('*')
          .eq('employee_id', user.id)
          .order('created_at', {
            ascending: false,
          })
          .limit(60),
      ]);

    setName(profile?.name || '');

    setRows(
      (entries || []) as TimeEntry[]
    );
  }

  useEffect(() => {
    load();
  }, []);

  function recifeToday() {
    return new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: 'America/Recife',
      }
    ).format(new Date());
  }

  function getNextKind(
    todayRows: TimeEntry[]
  ): PunchKind | null {
    const ordered = [...todayRows].sort(
      (a, b) =>
        new Date(a.created_at).getTime() -
        new Date(b.created_at).getTime()
    );

    const kinds = ordered.map(
      (row) => row.kind
    );

    if (kinds.length === 0) {
      return 'entrada';
    }

    if (
      kinds.length === 1 &&
      kinds[0] === 'entrada'
    ) {
      return 'saida_intervalo';
    }

    if (
      kinds.length === 2 &&
      kinds[0] === 'entrada' &&
      kinds[1] === 'saida_intervalo'
    ) {
      return 'retorno_intervalo';
    }

    if (
      kinds.length === 3 &&
      kinds[0] === 'entrada' &&
      kinds[1] === 'saida_intervalo' &&
      kinds[2] === 'retorno_intervalo'
    ) {
      return 'saida';
    }

    return null;
  }

  function getPosition():
    Promise<GeolocationPosition> {
    return new Promise(
      (resolve, reject) => {
        if (!window.isSecureContext) {
          reject(
            new Error(
              'A localização exige conexão segura (HTTPS).'
            )
          );
          return;
        }

        if (
          !('geolocation' in navigator)
        ) {
          reject(
            new Error(
              'Este navegador não oferece suporte à localização.'
            )
          );
          return;
        }

        let finished = false;

        const hardTimeout =
          window.setTimeout(() => {
            if (finished) return;

            finished = true;

            reject(
              new Error(
                'Não foi possível obter sua localização. Verifique se o GPS está ativado e se o navegador possui permissão.'
              )
            );
          }, 15000);

        navigator.geolocation
          .getCurrentPosition(
            (result) => {
              if (finished) return;

              finished = true;

              window.clearTimeout(
                hardTimeout
              );

              resolve(result);
            },

            (error) => {
              if (finished) return;

              finished = true;

              window.clearTimeout(
                hardTimeout
              );

              if (error.code === 1) {
                reject(
                  new Error(
                    'A localização está bloqueada para este site. Libere a permissão e tente novamente.'
                  )
                );

                return;
              }

              if (error.code === 2) {
                reject(
                  new Error(
                    'O celular não conseguiu determinar sua localização. Ative o GPS e tente novamente.'
                  )
                );

                return;
              }

              if (error.code === 3) {
                reject(
                  new Error(
                    'O GPS demorou demais para responder. Tente novamente em uma área com melhor sinal.'
                  )
                );

                return;
              }

              reject(
                new Error(
                  'Localização indisponível.'
                )
              );
            },

            {
              enableHighAccuracy: true,
              timeout: 12000,
              maximumAge: 0,
            }
          );
      }
    );
  }

  function resetPending() {
    setPosition(null);
    setPendingKind(null);
    setWaitingSelfie(false);
    setSelfieName('');
    setBusy(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function startPunch() {
    if (busy) return;

    setBusy(true);

    try {
      setMsg(
        'Obtendo localização...'
      );

      if (
        'permissions' in navigator
      ) {
        try {
          const permission =
            await navigator.permissions.query(
              {
                name:
                  'geolocation' as PermissionName,
              }
            );

          if (
            permission.state ===
            'denied'
          ) {
            throw new Error(
              'A localização está bloqueada para este site. Libere a permissão no navegador e tente novamente.'
            );
          }
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes(
              'bloqueada'
            )
          ) {
            throw error;
          }
        }
      }

      const result =
        await getPosition();

      const savedPosition = {
        latitude:
          result.coords.latitude,

        longitude:
          result.coords.longitude,

        accuracy:
          result.coords.accuracy,
      };

      setPosition(savedPosition);

      const todayRows =
        rows.filter(
          (row) =>
            row.work_date ===
            recifeToday()
        );

      const nextKind =
        getNextKind(todayRows);

      if (!nextKind) {
        throw new Error(
          'Todas as marcações previstas para hoje já foram realizadas.'
        );
      }

      setPendingKind(nextKind);

      const needsSelfie =
        nextKind === 'entrada' ||
        nextKind === 'saida';

      if (needsSelfie) {
        setWaitingSelfie(true);
        setBusy(false);

        setMsg(
          `Localização obtida — precisão aproximada ±${Math.round(
            savedPosition.accuracy
          )} m. Agora tire a selfie para continuar.`
        );

        return;
      }

      await sendPunch(
        savedPosition,
        null
      );
    } catch (error) {
      resetPending();

      setMsg(
        error instanceof Error
          ? error.message
          : 'Não foi possível iniciar o registro.'
      );
    }
  }

  async function sendPunch(
    savedPosition: SavedPosition,
    selfie: File | null
  ) {
    setBusy(true);

    try {
      setMsg(
        'Validando no servidor...'
      );

      const form = new FormData();

      form.append(
        'latitude',
        String(
          savedPosition.latitude
        )
      );

      form.append(
        'longitude',
        String(
          savedPosition.longitude
        )
      );

      form.append(
        'accuracy',
        String(
          savedPosition.accuracy
        )
      );

      if (selfie) {
        form.append(
          'selfie',
          selfie
        );
      }

      const s = supabase();

      const {
        data: { session },
      } = await s.auth.getSession();

      if (
        !session?.access_token
      ) {
        throw new Error(
          'Sua sessão expirou. Entre novamente no sistema.'
        );
      }

      const response =
        await fetch(
          '/api/punch',
          {
            method: 'POST',

            headers: {
              Authorization:
                `Bearer ${session.access_token}`,
            },

            body: form,
          }
        );

      let result: any = {};

      try {
        result =
          await response.json();
      } catch {
        // resposta sem JSON
      }

      if (!response.ok) {
        throw new Error(
          result.error ||
            result.message ||
            'Não foi possível registrar o ponto.'
        );
      }

      const successMessage =
        result.message ||
        'Ponto registrado com sucesso.';

      resetPending();

      setMsg(successMessage);

      await load();
    } catch (error) {
      setBusy(false);

      setMsg(
        error instanceof Error
          ? error.message
          : 'Não foi possível registrar o ponto.'
      );
    }
  }

  function openCamera() {
    /*
     * Agora a câmera é aberta diretamente
     * pelo clique do usuário.
     *
     * Isso evita o bloqueio que ocorre em
     * alguns navegadores quando input.click()
     * acontece depois de uma operação
     * assíncrona de GPS.
     */

    fileInputRef.current?.click();
  }

  async function selfieSelected(
    event:
      React.ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    if (!file) {
      setMsg(
        'Nenhuma selfie foi selecionada. Toque em "Tirar selfie" para tentar novamente.'
      );

      return;
    }

    setSelfieName(file.name);

    if (!position) {
      resetPending();

      setMsg(
        'A localização expirou. Inicie o registro novamente.'
      );

      return;
    }

    await sendPunch(
      position,
      file
    );
  }

  async function logout() {
    await supabase()
      .auth.signOut();

    location.href = '/';
  }

  return (
    <main>
      <div className="top">
        <div>
          <div className="brand">
            Ailton Hortifruti
          </div>

          <h1>Meu ponto</h1>

          <p className="muted">
            {name}
          </p>
        </div>

        <button
          className="linkbtn"
          onClick={logout}
        >
          Sair
        </button>
      </div>

      <div className="card hero">
        <p>{msg}</p>

        {!waitingSelfie && (
          <button
            disabled={busy}
            onClick={startPunch}
          >
            {busy
              ? 'Aguarde...'
              : '📍 Registrar ponto'}
          </button>
        )}

        {waitingSelfie && (
          <>
            <button
              disabled={busy}
              onClick={openCamera}
            >
              📷 Tirar selfie
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="user"
              onChange={
                selfieSelected
              }
              style={{
                display: 'none',
              }}
            />

            {selfieName && (
              <small>
                Foto selecionada:{' '}
                {selfieName}
              </small>
            )}

            <button
              type="button"
              className="linkbtn"
              disabled={busy}
              onClick={() => {
                resetPending();

                setMsg(
                  'Registro cancelado.'
                );
              }}
            >
              Cancelar
            </button>
          </>
        )}

        <small>
          Raio permitido: 80 m.
          Selfie obrigatória na entrada
          e na saída final. GPS
          impreciso será sinalizado.
        </small>
      </div>

      <div className="card">
        <h2>Histórico</h2>

        {rows.length === 0 ? (
          <p className="muted">
            Nenhum registro.
          </p>
        ) : (
          rows.map((row) => (
            <div
              className="row"
              key={row.id}
            >
              <div>
                <b>
                  {String(
                    row.kind
                  ).replaceAll(
                    '_',
                    ' '
                  )}
                </b>

                {row.suspicious && (
                  <span className="badge warn">
                    {' '}
                    GPS suspeito
                  </span>
                )}
              </div>

              <small>
                {new Date(
                  row.created_at
                ).toLocaleString(
                  'pt-BR',
                  {
                    timeZone:
                      'America/Recife',
                  }
                )}

                {' • '}

                {Math.round(
                  row.distance_m ||
                    0
                )}{' '}
                m

                {' • '}precisão ±
                {Math.round(
                  row.accuracy_m ||
                    0
                )}{' '}
                m
              </small>
            </div>
          ))
        )}
      </div>
    </main>
  );
}