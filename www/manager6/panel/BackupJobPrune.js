/*
 * Input panel for prune settings with a keep-all option intended to be used as
 * part of an edit/create window.
 */
Ext.define('PVE.panel.BackupJobPrune', {
    extend: 'Proxmox.panel.PruneInputPanel',
    xtype: 'pveBackupJobPrunePanel',
    mixins: ['Proxmox.Mixin.CBind'],

    onlineHelp: 'vzdump_retention',

    onGetValues: function (formValues) {
        if (this.needMask) {
            // isMasked() may not yet be true if not rendered once
            return {};
        } else if (this.isCreate && !this.rendered) {
            return this.keepAllDefaultForCreate ? { 'prune-backups': 'keep-all=1' } : {};
        }

        let options = { delete: [] };

        if ('max-protected-backups' in formValues) {
            options['max-protected-backups'] = formValues['max-protected-backups'];
        } else if (this.hasMaxProtected) {
            options.delete.push('max-protected-backups');
        }

        delete formValues['max-protected-backups'];
        delete formValues.delete;

        let retention = PVE.Parser.printPropertyString(formValues);
        if (retention === '') {
            options.delete.push('prune-backups');
        } else {
            options['prune-backups'] = retention;
        }

        if (this.isCreate) {
            delete options.delete;
        }

        return options;
    },

    updateComponents: function () {
        let me = this;

        let keepAll = me.down('proxmoxcheckbox[name=keep-all]').getValue();
        let anyValue = false;
        me.query('pmxPruneKeepField').forEach((field) => {
            anyValue = anyValue || field.getValue() !== null;
            field.setDisabled(keepAll);
        });
        me.down('component[name=no-keeps-hint]').setHidden(anyValue || keepAll);
    },

    listeners: {
        afterrender: function (panel) {
            if (panel.needMask) {
                panel.down('component[name=no-keeps-hint]').setHtml('');
                panel.mask(gettext('Backup content type not available for this storage.'));
            } else if (panel.isCreate && panel.keepAllDefaultForCreate) {
                panel.down('proxmoxcheckbox[name=keep-all]').setValue(true);
            }
            panel.down('component[name=pbs-hint]').setHidden(!panel.showPBSHint);

            let maxProtected = panel.down('proxmoxintegerfield[name=max-protected-backups]');
            maxProtected.setDisabled(!panel.hasMaxProtected);
            maxProtected.setHidden(!panel.hasMaxProtected);

            panel.query('pmxPruneKeepField').forEach((field) => {
                field.on('change', panel.updateComponents, panel);
            });
            panel.updateComponents();
        },
    },

    columnT: {
        xtype: 'proxmoxcheckbox',
        name: 'keep-all',
        boxLabel: gettext('Keep all backups'),
        listeners: {
            change: function (field, newValue) {
                let panel = field.up('pveBackupJobPrunePanel');
                panel.updateComponents();
            },
        },
    },

    columnB: [
        {
            xtype: 'component',
            userCls: 'pmx-hint',
            name: 'no-keeps-hint',
            hidden: true,
            padding: '5 1',
            cbind: {
                html: '{fallbackHintHtml}',
            },
        },
        {
            xtype: 'component',
            userCls: 'pmx-hint',
            name: 'pbs-hint',
            hidden: true,
            padding: '5 1',
            html: gettext(
                "It's preferred to configure backup retention directly on the Proxmox Backup Server.",
            ),
        },
        {
            xtype: 'proxmoxintegerfield',
            name: 'max-protected-backups',
            fieldLabel: gettext('Maximum Protected'),
            minValue: -1,
            hidden: true,
            disabled: true,
            emptyText: 'unlimited with Datastore.Allocate privilege, 5 otherwise',
            deleteEmpty: true,
            autoEl: {
                tag: 'div',
                'data-qtip': Ext.String.format(gettext('Use {0} for unlimited'), -1),
            },
        },
    ],
});
