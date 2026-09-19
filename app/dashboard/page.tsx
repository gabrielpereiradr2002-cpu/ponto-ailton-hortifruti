'use client';

import { useEffect, useState } from 'react';
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

export default function Dashboard() {
  const [msg, setMsg] = useState('Pronto para registrar.');
  const [rows, setRows] = useState<TimeEntry[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const s = supabase();

    const {
      data: { user },
    } = await s.auth.getUser();

    if (!user) {
      location.href = '/';
      return;
    }

    const [{ data: p }, { data: r }] = await Promise.all([
      s.from('profiles').select('name').eq('id', user.id).single(),
      s
        .from('time_entries')
        .select('*')
        .eq('employee_id', user.id)
        .order('created_at', { ascending: false })
        .limit(60),
    ]);

    setName(p?.name || '');
    setRows((r || []) as TimeEntry[]);
  }

  useEffect(() => {
    load();
  }, []);

  function recifeToday() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Recife',
    }).format(new Date());
  }

  function getNextKind(todayRows: TimeEntry[]) {
    const ordered = [...todayRows].sort(
      (a, b) =>
        new Date(a.created_at).getTime() -
        new Date(b.created_at).getTime()
    );

    const kinds = ordered.map((r) => r.kind);

    if (kinds.length === 0) return 'entrada';

    if (kinds.length === 1 && kinds[0] === 'entrada') {
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

  function getPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!window.isSecureContext) {
        reject(
          new Error(
            'A localização exige uma conexão segura (HTTPS).'
          )
        );
        return;
      }

      if (!('geolocation' in navigator)) {
        reject(
          new Error(
            'Este navegador não oferece suporte à localização.'
          )
        );
        return;
      }

      let finished = false;

      // Timeout independente do navegador.
      // Assim a tela nunca fica presa para sempre.
      const hardTimeout = window.setTimeout(() => {
        if (finished) return;

        finished = true;

        reject(
          new Error(
            'Não foi possível obter sua localização. Verifique se o GPS do celular está ativado e se o navegador possui permissão de localização.'
          )
        );
      }, 15000);

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (finished) return;

          finished = true;
          window.clearTimeout(hardTimeout);

          resolve(position);
        },

        (error) => {
          if (finished) return;

          finished = true;
          window.clearTimeout(hardTimeout);

          let message =
            'Não foi possível obter sua localização.';

          if (error.code === 1) {
            message =
              'A localização está bloqueada para este site. Libere a permissão de localização no navegador e tente novamente.';
          }

          if (error.code === 2) {
            message =
              'O celular não conseguiu determinar sua localização. Ative o GPS e tente novamente.';
          }

          if (error.code === 3) {
            message =
              'O GPS demorou demais para responder. Vá para uma área com melhor sinal e tente novamente.';
          }

          reject(new Error(message));
        },

        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        }
      );
    });
  }

  function captureSelfie(): Promise<File> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');

      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'user';
      input.style.display = 'none';

      document.body.appendChild(input);

      const cleanup = () => {
        input.onchange = null;
        input.remove();
      };

      input.onchange = () => {
        const file = input.files?.[0];

        cleanup();

        if (!file) {
          reject(
            new Error(
              'Selfie cancelada. O ponto não foi registrado.'
            )
          );
          return;
        }

        resolve(file);
      };

      input.click();
    });
  }

  async function punch() {
    if (busy) return;

    setBusy(true);

    try {
      setMsg('Obtendo localização...');

      // Em navegadores que suportam Permissions API,
      // detectamos bloqueio antes de esperar o GPS.
      if ('permissions' in navigator) {
        try {
          const permission =
            await navigator.permissions.query({
              name: 'geolocation' as PermissionName,
            });

          if (permission.state === 'denied') {
            throw new Error(
              'A localização está bloqueada para este site. Libere a permissão de localização no navegador e tente novamente.'
            );
          }
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes('bloqueada')
          ) {
            throw error;
          }

          // Alguns navegadores móveis não suportam
          // consulta de permissão para geolocalização.
        }
      }

      const position = await getPosition();

      const accuracy = Math.round(
        position.coords.accuracy
      );

      setMsg(
        `Localização obtida — precisão aproximada ±${accuracy} m.`
      );

      const todayRows = rows.filter(
        (row) => row.work_date === recifeToday()
      );

      const nextKind = getNextKind(todayRows);

      let selfie: File | null = null;

      /*
       * Selfie:
       * - primeira entrada: SIM
       * - saída para intervalo: NÃO
       * - retorno do intervalo: NÃO
       * - saída final: SIM
       *
       * O servidor continua sendo a autoridade
       * sobre qual tipo de batida será registrado.
       */
      if (
        nextKind === 'entrada' ||
        nextKind === 'saida'
      ) {
        setMsg(
          nextKind === 'entrada'
            ? 'Localização obtida. Tire a selfie de entrada.'
            : 'Localização obtida. Tire a selfie de saída.'
        );

        selfie = await captureSelfie();
      }

      setMsg('Validando no servidor...');

      const form = new FormData();

      form.append(
        'latitude',
        String(position.coords.latitude)
      );

      form.append(
        'longitude',
        String(position.coords.longitude)
      );

      form.append(
        'accuracy',
        String(position.coords.accuracy)
      );

      if (selfie) {
        form.append('selfie', selfie);
      }

      const s = supabase();

      const {
        data: { session },
      } = await s.auth.getSession();

      if (!session?.access_token) {
        throw new Error(
          'Sua sessão expirou. Entre novamente no sistema.'
        );
      }

      const response = await fetch('/api/punch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: form,
      });

      let result: any = {};

      try {
        result = await response.json();
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

      setMsg(
        result.message ||
          'Ponto registrado com sucesso.'
      );

      await load();
    } catch (error) {
      setMsg(
        error instanceof Error
          ? error.message
          : 'Não foi possível registrar o ponto.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await supabase().auth.signOut();
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

          <p className="muted">{name}</p>
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

        <button
          disabled={busy}
          onClick={punch}
        >
          {busy
            ? 'Aguarde...'
            : '📍 Registrar ponto'}
        </button>

        <small>
          Raio permitido: 80 m. Selfie obrigatória
          na entrada e na saída final. GPS impreciso
          será sinalizado.
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
                  {String(row.kind).replaceAll(
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
                ).toLocaleString('pt-BR', {
                  timeZone: 'America/Recife',
                })}
                {' • '}
                {Math.round(
                  row.distance_m || 0
                )}{' '}
                m
                {' • '}precisão ±
                {Math.round(
                  row.accuracy_m || 0
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