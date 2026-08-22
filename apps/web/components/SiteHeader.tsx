'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import Mascot from './Mascot';
import styles from './SiteHeader.module.css';
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site';

function SearchForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, setPending] = useState('');

  // 一覧へ戻ったときに検索条件を保持する。
  useEffect(() => {
    setPending(params.get('q') ?? '');
  }, [params]);

  return (
    <form
      className={styles.form}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = pending.trim();
        router.push(q ? `/companies/?q=${encodeURIComponent(q)}` : '/companies/');
      }}
    >
      <label className="visuallyHidden" htmlFor="site-search">
        会社名で検索
      </label>
      <input
        id="site-search"
        className={styles.input}
        value={pending}
        onChange={(e) => setPending(e.target.value)}
        placeholder="会社名で検索（例: ミナト）"
        autoComplete="off"
      />
      <button className={styles.submit} type="submit">
        検索
      </button>
    </form>
  );
}

export default function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link className={styles.brand} href="/companies/">
          <Mascot size={40} mood="smile" />
          <span className={styles.brandText}>
            <span className={styles.logo}>{SITE_NAME}</span>
            <span className={styles.tagline}>{SITE_TAGLINE}</span>
          </span>
        </Link>
        <Suspense fallback={<div className={styles.form} />}>
          <SearchForm />
        </Suspense>
      </div>
    </header>
  );
}
