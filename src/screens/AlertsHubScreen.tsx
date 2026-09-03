import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { ALL_ALERT_KINDS, AlertKind } from '../config/types';
import { useConfigStore } from '../state/configStore';
import { useRuntimeStore } from '../state/runtimeStore';
import { SupportContactFooter } from '../components/SupportContactFooter';

const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  lean_signal: 'Lean signals',
  order_placed: 'Orders placed',
  order_filled: 'Orders filled',
  ioc_miss: 'IOC misses',
  trade_result: 'Trade results',
  protect_sell: 'Protect sells',
  daily_loss_stop: 'Daily loss stop',
  error: 'Errors',
};

export function AlertsHubScreen() {
  const prefs = useConfigStore((s) => s.config.alert_prefs);
  const setAlertPref = useConfigStore((s) => s.setAlertPref);
  const alerts = useRuntimeStore((s) => s.alerts);
  const unread = useRuntimeStore((s) => s.unread);
  const markAllRead = useRuntimeStore((s) => s.markAllRead);
  const deleteAlertsByIds = useRuntimeStore((s) => s.deleteAlertsByIds);
  const [muteOpen, setMuteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const mutedCount = ALL_ALERT_KINDS.filter((k) => !(prefs[k].enabled && prefs[k].push)).length;

  const selectedCount = selectedIds.size;
  const allIds = useMemo(() => alerts.map((a) => a.id), [alerts]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  };

  const requestDeleteSelected = () => {
    if (selectedCount === 0) return;
    setConfirmOpen(true);
  };

  const confirmDeleteSelected = async () => {
    if (deleting || selectedCount === 0) return;
    setDeleting(true);
    const idsToDelete = Array.from(selectedIds);
    try {
      await deleteAlertsByIds(idsToDelete);
      setSelectedIds(new Set());
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={styles.root} testID="screen-alerts-hub">
      <View style={styles.header}>
        <Text style={styles.intro} testID="alerts-unread">
          Unread: {unread}
        </Text>
        <Pressable onPress={markAllRead} testID="btn-mark-all-read">
          <Text style={styles.link}>Mark all read</Text>
        </Pressable>
      </View>

      <Pressable
        style={styles.collapseHeader}
        onPress={() => setMuteOpen((v) => !v)}
        testID="btn-toggle-mute-matrix"
      >
        <Text style={styles.section}>Mute matrix (push)</Text>
        <Text style={styles.collapseHint}>
          {muteOpen ? 'Hide' : 'Show'}
          {mutedCount > 0 ? ` · ${mutedCount} muted` : ''}
        </Text>
      </Pressable>

      {muteOpen
        ? ALL_ALERT_KINDS.map((k) => (
            <View key={k} style={styles.muteRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.kind}>{ALERT_KIND_LABELS[k] || k}</Text>
                <Text style={styles.state}>
                  {prefs[k].enabled ? (prefs[k].push ? 'push on' : 'silent log') : 'disabled'}
                </Text>
              </View>
              <Switch
                testID={`alert-push-${k}`}
                value={prefs[k].enabled && prefs[k].push}
                onValueChange={(v) => setAlertPref(k, { enabled: true, push: v })}
                trackColor={{ true: colors.accent, false: colors.mute }}
              />
            </View>
          ))
        : null}

      <View style={[styles.sectionRow, { marginTop: spacing.xs }]}>
        <Text style={styles.section}>Recent ({alerts.length})</Text>
        {alerts.length > 0 ? (
          <Pressable
            testID="btn-select-all-alerts"
            onPress={toggleSelectAll}
            style={styles.selectAllBtn}
          >
            <Text style={styles.selectAllText}>{allSelected ? 'Deselect all' : 'Select all'}</Text>
          </Pressable>
        ) : null}
      </View>
      {selectedCount > 0 ? (
        <Pressable
          testID="btn-delete-selected-alerts"
          onPress={requestDeleteSelected}
          style={styles.deleteSelectedBtn}
        >
          <Text style={styles.deleteSelectedText}>Delete selected ({selectedCount})</Text>
        </Pressable>
      ) : null}
      <FlatList
        testID="alerts-recent-list"
        style={styles.list}
        data={alerts}
        keyExtractor={(a) => a.id}
        contentContainerStyle={alerts.length === 0 ? styles.emptyPad : { paddingBottom: 24 }}
        ListEmptyComponent={
          <Text style={styles.empty}>No alerts yet — lean signals and orders appear here.</Text>
        }
        ListFooterComponent={<SupportContactFooter compact />}
        renderItem={({ item }) => (
          <View style={[styles.alert, !item.read && styles.unread, { flexDirection: 'row' }]}>
            <Pressable
              testID={`btn-select-alert-${item.id}`}
              onPress={() => toggleOne(item.id)}
              style={[
                styles.checkbox,
                selectedIds.has(item.id) ? styles.checkboxOn : undefined,
              ]}
            />
            <View style={{ flex: 1 }}>
              <View style={styles.alertTop}>
                <Text style={styles.kind} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.time}>{formatAlertTime(item.at)}</Text>
              </View>
              <Text style={styles.body} numberOfLines={4}>
                {item.body}
              </Text>
              <Text style={styles.kindMeta}>{item.kind}</Text>
            </View>
          </View>
        )}
      />

      <Modal
        visible={confirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => (deleting ? null : setConfirmOpen(false))}
        testID="modal-delete-alerts"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalLead}>
              Delete {selectedCount} alert{selectedCount === 1 ? '' : 's'}?
            </Text>
            <View style={styles.modalButtons}>
              <Pressable
                testID="btn-cancel-delete-alerts"
                onPress={() => (deleting ? null : setConfirmOpen(false))}
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                disabled={deleting}
              >
                <Text style={styles.modalBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="btn-confirm-delete-alerts"
                onPress={() => void confirmDeleteSelected()}
                style={[styles.modalBtn, styles.modalBtnDanger]}
                disabled={deleting}
              >
                <Text style={styles.modalBtnText}>{deleting ? 'Deleting…' : 'Delete'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function formatAlertTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: spacing.md, gap: 6 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  intro: { color: colors.textSecondary, fontSize: 13 },
  link: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  section: { color: colors.gold, fontWeight: '700', fontSize: 13 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectAllBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  selectAllText: { color: colors.accent, fontWeight: '700', fontSize: 12 },
  deleteSelectedBtn: {
    marginTop: 2,
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  deleteSelectedText: { color: colors.bg, fontWeight: '800', fontSize: 13 },
  collapseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
    marginTop: spacing.sm,
  },
  collapseHint: { color: colors.mute, fontSize: 11, fontWeight: '600' },
  muteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 36,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 2,
    marginRight: 10,
    backgroundColor: colors.surface,
  },
  checkboxOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  kind: { color: colors.textPrimary, fontWeight: '600', fontSize: 13, flexShrink: 1 },
  state: { color: colors.mute, fontSize: 11, marginTop: 1 },
  list: { flex: 1 },
  emptyPad: { flexGrow: 1, justifyContent: 'center' },
  empty: { color: colors.mute, textAlign: 'center', paddingVertical: 20, fontSize: 13 },
  alert: {
    backgroundColor: colors.surfaceElevated,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unread: { borderColor: colors.accent },
  alertTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' },
  time: { color: colors.mute, fontSize: 10 },
  body: { color: colors.mute, fontSize: 11, marginTop: 2, lineHeight: 15 },
  kindMeta: { color: colors.mute, fontSize: 10, marginTop: 2 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 12,
  },
  modalLead: { color: colors.textPrimary, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  modalButtons: { flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  modalBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  modalBtnSecondary: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  modalBtnDanger: { backgroundColor: colors.danger, borderWidth: 1, borderColor: colors.danger },
  modalBtnText: { color: colors.bg, fontWeight: '800', fontSize: 13 },
});
