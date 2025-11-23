Ext.define('PVE.window.Backup', {
    extend: 'Ext.window.Window',

    resizable: false,

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        if (!me.vmid) {
            throw 'no VM ID specified';
        }

        if (!me.vmtype) {
            throw 'no VM type specified';
        }

        let compressionSelector = Ext.create('PVE.form.BackupCompressionSelector', {
            name: 'compress',
            value: 'zstd',
            fieldLabel: gettext('Compression'),
        });

        let modeSelector = Ext.create('PVE.form.BackupModeSelector', {
            fieldLabel: gettext('Mode'),
            value: 'snapshot',
            name: 'mode',
        });

        let mailtoField = Ext.create('Ext.form.field.Text', {
            fieldLabel: gettext('Send email to'),
            name: 'mailto',
            hidden: true,
            emptyText: Proxmox.Utils.noneText,
        });

        let notificationModeSelector = Ext.create({
            xtype: 'proxmoxKVComboBox',
            comboItems: [
                ['notification-system', gettext('Use global settings')],
                ['legacy-sendmail', gettext('Use sendmail (legacy)')],
            ],
            fieldLabel: gettext('Notification'),
            name: 'notification-mode',
            value: 'notification-system',
            listeners: {
                change: function (field, value) {
                    mailtoField.setHidden(value === 'notification-system');
                },
            },
        });

        let pbsChangeDetectionModeSelector = Ext.create({
            xtype: 'proxmoxKVComboBox',
            flex: 1,
            disabled: true,
            name: 'pbs-change-detection-mode',
            deleteEmpty: true,
            value: '__default__',
            comboItems: [
                ['__default__', 'Default'],
                ['data', 'Data'],
                ['metadata', 'Metadata'],
            ],
        });

        let pbsChangeDetection = Ext.create('Ext.form.FieldContainer', {
            fieldLabel: gettext('PBS change detection mode'),
            hidden: true,
            layout: {
                type: 'hbox',
                align: 'center',
            },
            items: [
                pbsChangeDetectionModeSelector,
                {
                    xtype: 'box',
                    html: `<i class="fa fa-question-circle" data-qtip="
			${gettext('Mode to detect file changes and switch archive encoding format for container backups to Proxmox Backup Server. Not available for VM backups.')}
		    "></i>`,
                    padding: 5,
                },
            ],
        });

        const keepNames = [
            ['keep-last', gettext('Keep Last')],
            ['keep-hourly', gettext('Keep Hourly')],
            ['keep-daily', gettext('Keep Daily')],
            ['keep-weekly', gettext('Keep Weekly')],
            ['keep-monthly', gettext('Keep Monthly')],
            ['keep-yearly', gettext('Keep Yearly')],
        ];

        let pruneSettings = keepNames.map((name) =>
            Ext.create('Ext.form.field.Display', {
                name: name[0],
                fieldLabel: name[1],
                hidden: true,
            }),
        );

        let removeCheckbox = Ext.create('Proxmox.form.Checkbox', {
            name: 'remove',
            checked: false,
            hidden: true,
            uncheckedValue: 0,
            fieldLabel: gettext('Prune'),
            autoEl: {
                tag: 'div',
                'data-qtip': gettext('Prune older backups afterwards'),
            },
            handler: function (checkbox, value) {
                pruneSettings.forEach((field) => field.setHidden(!value));
                me.down('label[name="pruneLabel"]').setHidden(!value);
            },
        });

        let initialDefaults = false;

        var storagesel = Ext.create('PVE.form.StorageSelector', {
            nodename: me.nodename,
            name: 'storage',
            fieldLabel: gettext('Storage'),
            storageContent: 'backup',
            allowBlank: false,
            listeners: {
                change: function (f, v) {
                    if (!initialDefaults) {
                        me.setLoading(false);
                    }

                    if (v === null || v === undefined || v === '') {
                        return;
                    }

                    let store = f.getStore();
                    let rec = store.findRecord('storage', v, 0, false, true, true);

                    if (rec && rec.data && rec.data.type === 'pbs') {
                        compressionSelector.setValue('zstd');
                        compressionSelector.setDisabled(true);
                        if (me.vmtype === 'lxc') {
                            pbsChangeDetectionModeSelector.setValue('__default__');
                            pbsChangeDetectionModeSelector.setDisabled(false);
                            pbsChangeDetection.setHidden(false);
                        } else {
                            pbsChangeDetectionModeSelector.setDisabled(true);
                            pbsChangeDetection.setHidden(true);
                        }
                    } else {
                        if (!compressionSelector.getEditable()) {
                            compressionSelector.setDisabled(false);
                        }
                        pbsChangeDetectionModeSelector.setDisabled(true);
                        pbsChangeDetection.setHidden(true);
                    }

                    Proxmox.Utils.API2Request({
                        url: `/nodes/${me.nodename}/vzdump/defaults`,
                        method: 'GET',
                        params: {
                            storage: v,
                        },
                        waitMsgTarget: me,
                        success: function (response, opts) {
                            const data = response.result.data;

                            if (!initialDefaults) {
                                let notificationMode = data['notification-mode'] ?? 'auto';
                                let mailto = data.mailto;

                                if (notificationMode === 'auto' && mailto !== undefined) {
                                    notificationMode = 'legacy-sendmail';
                                }
                                if (notificationMode === 'auto' && mailto === undefined) {
                                    notificationMode = 'notification-system';
                                }

                                notificationModeSelector.setValue(notificationMode);
                                if (mailto !== undefined) {
                                    mailtoField.setValue(mailto);
                                }
                            }
                            if (!initialDefaults && data.mode !== undefined) {
                                modeSelector.setValue(data.mode);
                            }
                            if (!initialDefaults && (data['notes-template'] ?? false)) {
                                me.down('field[name=notes-template]').setValue(
                                    PVE.Utils.unEscapeNotesTemplate(data['notes-template']),
                                );
                            }

                            initialDefaults = true;

                            // always update storage dependent properties
                            if (data['prune-backups'] !== undefined) {
                                const keepParams = PVE.Parser.parsePropertyString(
                                    data['prune-backups'],
                                );
                                if (!keepParams['keep-all']) {
                                    removeCheckbox.setHidden(false);
                                    pruneSettings.forEach(function (field) {
                                        const keep = keepParams[field.name];
                                        if (keep) {
                                            field.setValue(keep);
                                        } else {
                                            field.reset();
                                        }
                                    });
                                    return;
                                }
                            }

                            // no defaults or keep-all=1
                            removeCheckbox.setHidden(true);
                            removeCheckbox.setValue(false);
                            pruneSettings.forEach((field) => field.reset());
                        },
                        failure: function (response, opts) {
                            initialDefaults = true;

                            removeCheckbox.setHidden(true);
                            removeCheckbox.setValue(false);
                            pruneSettings.forEach((field) => field.reset());

                            Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                        },
                    });
                },
            },
        });

        let protectedCheckbox = Ext.create('Proxmox.form.Checkbox', {
            name: 'protected',
            checked: false,
            uncheckedValue: 0,
            fieldLabel: gettext('Protected'),
            // Tiny amount of padding to stop the UI from shifting
            // when the 'mailto' field is shown.
            padding: '0 0 1 0',
        });

        me.formPanel = Ext.create('Proxmox.panel.InputPanel', {
            bodyPadding: 10,
            border: false,
            column1: [storagesel, modeSelector, protectedCheckbox, pbsChangeDetection],
            column2: [compressionSelector, notificationModeSelector, mailtoField, removeCheckbox],
            columnB: [
                {
                    xtype: 'textareafield',
                    name: 'notes-template',
                    fieldLabel: gettext('Notes'),
                    anchor: '100%',
                    value: '{{guestname}}',
                },
                {
                    xtype: 'box',
                    style: {
                        margin: '8px 0px',
                        'line-height': '1.5em',
                    },
                    html: Ext.String.format(
                        gettext('Possible template variables are: {0}'),
                        PVE.Utils.notesTemplateVars.map((v) => `<code>{{${v}}}</code>`).join(', '),
                    ),
                },
                {
                    xtype: 'label',
                    name: 'pruneLabel',
                    text: gettext('Storage Retention Configuration') + ':',
                    hidden: true,
                },
                {
                    layout: 'hbox',
                    border: false,
                    defaults: {
                        border: false,
                        layout: 'anchor',
                        flex: 1,
                    },
                    items: [
                        {
                            padding: '0 10 0 0',
                            defaults: {
                                labelWidth: 110,
                            },
                            items: [pruneSettings[0], pruneSettings[2], pruneSettings[4]],
                        },
                        {
                            padding: '0 0 0 10',
                            defaults: {
                                labelWidth: 110,
                            },
                            items: [pruneSettings[1], pruneSettings[3], pruneSettings[5]],
                        },
                    ],
                },
            ],
        });

        var submitBtn = Ext.create('Ext.Button', {
            text: gettext('Backup'),
            handler: function () {
                var storage = storagesel.getValue();
                let values = me.formPanel.getValues();
                var params = {
                    storage: storage,
                    vmid: me.vmid,
                    mode: values.mode,
                    remove: values.remove,
                };

                if (values.mailto) {
                    params.mailto = values.mailto;
                }

                if (values['notification-mode']) {
                    params['notification-mode'] = values['notification-mode'];
                }

                if (values.compress) {
                    params.compress = values.compress;
                }

                if (values.protected) {
                    params.protected = values.protected;
                }

                if (values['pbs-change-detection-mode']) {
                    params['pbs-change-detection-mode'] = values['pbs-change-detection-mode'];
                }

                if (values['notes-template']) {
                    params['notes-template'] = PVE.Utils.escapeNotesTemplate(
                        values['notes-template'],
                    );
                }

                Proxmox.Utils.API2Request({
                    url: '/nodes/' + me.nodename + '/vzdump',
                    params: params,
                    method: 'POST',
                    failure: function (response, opts) {
                        Ext.Msg.alert('Error', response.htmlStatus);
                    },
                    success: function (response, options) {
                        // close later so we reload the grid
                        // after the task has completed
                        me.hide();

                        var upid = response.result.data;

                        var win = Ext.create('Proxmox.window.TaskViewer', {
                            upid: upid,
                            listeners: {
                                close: function () {
                                    me.close();
                                },
                            },
                        });
                        win.show();
                    },
                });
            },
        });

        var helpBtn = Ext.create('Proxmox.button.Help', {
            onlineHelp: 'chapter_vzdump',
            listenToGlobalEvent: false,
            hidden: false,
        });

        let guestTypeStr = me.vmtype === 'lxc' ? 'CT' : 'VM';
        let formattedGuestIdentifier = PVE.Utils.getFormattedGuestIdentifier(me.vmid, me.vmname);
        let title = `${gettext('Backup')} ${guestTypeStr} ${formattedGuestIdentifier}`;

        Ext.apply(me, {
            title: title,
            modal: true,
            layout: 'auto',
            border: false,
            width: 600,
            items: [me.formPanel],
            buttons: [helpBtn, '->', submitBtn],
            listeners: {
                afterrender: function () {
                    /// cleared within the storage selector's change listener
                    me.setLoading(gettext('Please wait...'));
                    storagesel.setValue(me.storage);
                },
            },
        });

        me.callParent();
    },
});
