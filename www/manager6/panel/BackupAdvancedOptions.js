/*
 * Input panel for advanced backup options intended to be used as part of an edit/create window.
 */
Ext.define('PVE.panel.BackupAdvancedOptions', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveBackupAdvancedOptionsPanel',
    mixins: ['Proxmox.Mixin.CBind'],

    cbindData: function () {
        let me = this;
        me.isCreate = !!me.isCreate;
        return {};
    },

    viewModel: {
        data: {},
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        toggleFleecing: function (cb, value) {
            let me = this;
            me.lookup('fleecingStorage').setDisabled(!value);
        },

        control: {
            'proxmoxcheckbox[reference=fleecingEnabled]': {
                change: 'toggleFleecing',
            },
        },
    },

    onGetValues: function (formValues) {
        let me = this;
        if (me.needMask) {
            // isMasked() may not yet be true if not rendered once
            return {};
        }

        if (!formValues.id && me.isCreate) {
            formValues.id = 'backup-' + Ext.data.identifier.Uuid.Global.generate().slice(0, 13);
        }

        let options = {};

        if (!me.isCreate) {
            options.delete = []; // to avoid having to check this all the time
        }
        const deletePropertyOnEdit = me.isCreate
            ? () => {
                  /* no-op on create */
              }
            : (key) => options.delete.push(key);

        let fleecing = {},
            fleecingOptions = ['fleecing-enabled', 'fleecing-storage'];
        let performance = {},
            performanceOptions = ['max-workers', 'pbs-entries-max'];

        for (const [key, value] of Object.entries(formValues)) {
            if (performanceOptions.includes(key)) {
                performance[key] = value;
                // deleteEmpty is not currently implemented for pveBandwidthField
            } else if (key === 'bwlimit' && value === '') {
                deletePropertyOnEdit('bwlimit');
            } else if (key === 'delete') {
                if (Array.isArray(value)) {
                    value
                        .filter((opt) => !performanceOptions.includes(opt))
                        .forEach((opt) => deletePropertyOnEdit(opt));
                } else if (!performanceOptions.includes(formValues.delete)) {
                    deletePropertyOnEdit(value);
                }
            } else if (fleecingOptions.includes(key)) {
                let fleecingKey = key.slice('fleecing-'.length);
                fleecing[fleecingKey] = value;
            } else {
                options[key] = value;
            }
        }

        if (Object.keys(performance).length > 0) {
            options.performance = PVE.Parser.printPropertyString(performance);
        } else {
            deletePropertyOnEdit('performance');
        }

        if (Object.keys(fleecing).length > 0) {
            options.fleecing = PVE.Parser.printPropertyString(fleecing);
        } else {
            deletePropertyOnEdit('fleecing');
        }

        if (me.isCreate) {
            delete options.delete;
        }

        return options;
    },

    onSetValues: function (values) {
        if (values.fleecing) {
            for (const [key, value] of Object.entries(values.fleecing)) {
                values[`fleecing-${key}`] = value;
            }
            delete values.fleecing;
        }
        if (values['pbs-change-detection-mode'] === '__default__') {
            delete values['pbs-change-detection-mode'];
        }
        return values;
    },

    updateCompression: function (value, disabled) {
        this.lookup('zstdThreadCount').setDisabled(disabled || value !== 'zstd');
    },

    items: [
        {
            xtype: 'pveTwoColumnContainer',
            startColumn: {
                xtype: 'pmxDisplayEditField',
                vtype: 'ConfigId',
                fieldLabel: gettext('Job ID'),
                emptyText: gettext('Autogenerate'),
                name: 'id',
                allowBlank: true,
                cbind: {
                    editable: '{isCreate}',
                },
            },
            endFlex: 2,
            endColumn: {
                xtype: 'displayfield',
                value: gettext('Can be used in notification matchers to match this job.'),
            },
        },
        {
            xtype: 'pveTwoColumnContainer',
            startColumn: {
                xtype: 'pveBandwidthField',
                name: 'bwlimit',
                fieldLabel: gettext('Bandwidth Limit'),
                emptyText: gettext('Fallback'),
                backendUnit: 'KiB',
                allowZero: true,
                emptyValue: '',
                autoEl: {
                    tag: 'div',
                    'data-qtip': Ext.String.format(gettext('Use {0} for unlimited'), 0),
                },
            },
            endFlex: 2,
            endColumn: {
                xtype: 'displayfield',
                value: `${gettext('Limit I/O bandwidth.')} ${Ext.String.format(gettext('Schema default: {0}'), 0)}`,
            },
        },
        {
            xtype: 'pveTwoColumnContainer',
            startColumn: {
                xtype: 'proxmoxintegerfield',
                name: 'zstd',
                reference: 'zstdThreadCount',
                fieldLabel: gettext('Zstd Threads'),
                fieldStyle: 'text-align: right',
                emptyText: gettext('Fallback'),
                minValue: 0,
                cbind: {
                    deleteEmpty: '{!isCreate}',
                },
                autoEl: {
                    tag: 'div',
                    'data-qtip': gettext('With 0, half of the available cores are used'),
                },
            },
            endFlex: 2,
            endColumn: {
                xtype: 'displayfield',
                value: `${gettext('Threads used for zstd compression (non-PBS).')} ${Ext.String.format(gettext('Schema default: {0}'), 1)}`,
            },
        },
        {
            xtype: 'pveTwoColumnContainer',
            startColumn: {
                xtype: 'proxmoxintegerfield',
                name: 'max-workers',
                minValue: 1,
                maxValue: 256,
                fieldLabel: gettext('IO-Workers'),
                fieldStyle: 'text-align: right',
                emptyText: gettext('Fallback'),
                cbind: {
                    deleteEmpty: '{!isCreate}',
                },
            },
            endFlex: 2,
            endColumn: {
                xtype: 'displayfield',
                value: `${gettext('I/O workers in the QEMU process (VMs only).')} ${Ext.String.format(gettext('Schema default: {0}'), 16)}`,
            },
        },
        {
            xtype: 'pveTwoColumnContainer',
            startColumn: {
                xtype: 'proxmoxcheckbox',
                name: 'fleecing-enabled',
                reference: 'fleecingEnabled',
                fieldLabel: gettext('Fleecing'),
                uncheckedValue: 0,
                value: 0,
            },
            endFlex: 2,
            endColumn: {
                xtype: 'displayfield',
                value: gettext(
                    'Backup write cache that can reduce IO pressure inside guests (VMs only).',
                ),
            },
        },
        {
            xtype: 'pveTwoColumnContainer',
            startColumn: {
                xtype: 'pveStorageSelector',
                name: 'fleecing-storage',
                fieldLabel: gettext('Fleecing Storage'),
                reference: 'fleecingStorage',
                clusterView: true,
                storageContent: 'images',
                allowBlank: false,
                disabled: true,
            },
            endFlex: 2,
            endColumn: {
                xtype: 'displayfield',
                value: gettext(
                    'Prefer a fast and local storage, ideally with support for discard and thin-provisioning or sparse files.',
                ),
            },
        },
        {
            // It's part of the 'performance' property string, so have a field to preserve the
            // value, but don't expose it. It's a rather niche setting and difficult to
            // convey/understand what it does.
            xtype: 'proxmoxintegerfield',
            name: 'pbs-entries-max',
            hidden: true,
            fieldLabel: 'TODO',
            fieldStyle: 'text-align: right',
            emptyText: 'TODO',
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
        {
            xtype: 'pveTwoColumnContainer',
            startColumn: {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('Repeat missed'),
                name: 'repeat-missed',
                uncheckedValue: 0,
                defaultValue: 0,
                cbind: {
                    deleteDefaultValue: '{!isCreate}',
                },
            },
            endFlex: 2,
            endColumn: {
                xtype: 'displayfield',
                value: gettext(
                    "Run jobs as soon as possible if they couldn't start on schedule, for example, due to the node being offline.",
                ),
            },
        },
        {
            xtype: 'pveTwoColumnContainer',
            startColumn: {
                xtype: 'proxmoxKVComboBox',
                fieldLabel: gettext('PBS change detection mode'),
                name: 'pbs-change-detection-mode',
                deleteEmpty: true,
                value: '__default__',
                comboItems: [
                    ['__default__', 'Default'],
                    ['data', 'Data'],
                    ['metadata', 'Metadata'],
                ],
            },
            endFlex: 2,
            endColumn: {
                xtype: 'displayfield',
                value: gettext(
                    'Mode to detect file changes and switch archive encoding format for container backups.',
                ),
            },
        },
        {
            xtype: 'component',
            padding: '5 1',
            html: `<span class="pmx-hint">${gettext('Note')}</span>: ${gettext(
                "The node-specific 'vzdump.conf' or, if this is not set, the default from the config schema is used to determine fallback values.",
            )}`,
        },
    ],
});
