-- R1D-01: a parser failure may wait for source deletion without derived features.

alter table public.document_uploads
  drop constraint document_uploads_kind_shape;
alter table public.document_uploads
  add constraint document_uploads_kind_shape check (
    (
      kind = 'company'
      and section is not null
      and derived_features is null
      and lifecycle in ('pending', 'stored', 'failed')
    )
    or (
      kind = 'credit_report'
      and section is null
      and (
        (lifecycle in ('pending', 'stored', 'failed') and derived_features is null)
        or (lifecycle = 'parsed' and private.derived_features_valid(derived_features))
        or (lifecycle = 'delete_pending' and (
          derived_features is null or private.derived_features_valid(derived_features)
        ))
        or (lifecycle = 'purged' and (
          derived_features is null or private.derived_features_valid(derived_features)
        ))
      )
    )
  );
