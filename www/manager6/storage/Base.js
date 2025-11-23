Ext.define('PVE.panel.StorageBase', {
    extend: 'Proxmox.panel.InputPanel',
    controller: 'storageEdit',

    type: '',

    onGetValues: function (values) {
        let me = this;

        if (me.isCreate) {
            values.type = me.type;
        } else {
            delete values.storage;
        }

        values.disable = values.enable ? 0 : 1;
        delete values.enable;

        return values;
    },

    initComponent: function () {
        let me = this;

        me.column1.unshift({
            xtype: me.isCreate ? 'textfield' : 'displayfield',
            name: 'storage',
            value: me.storageId || '',
            fieldLabel: 'ID',
            vtype: 'StorageId',
            allowBlank: false,
        });

        me.column2 = me.column2 || [];
        me.column2.unshift(
            {
                xtype: 'pveNodeSelector',
                name: 'nodes',
                reference: 'storageNodeRestriction',
                disabled: me.storageId === 'local',
                fieldLabel: gettext('Nodes'),
                emptyText: gettext('All') + ' (' + gettext('No restrictions') + ')',
                multiSelect: true,
                autoSelect: false,
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'enable',
                checked: true,
                uncheckedValue: 0,
                fieldLabel: gettext('Enable'),
            },
        );

        const addAdvancedWidget = (widget) => {
            me.advancedColumn1 = me.advancedColumn1 || [];
            me.advancedColumn2 = me.advancedColumn2 || [];
            if (me.advancedColumn2.length < me.advancedColumn1.length) {
                me.advancedColumn2.unshift(widget);
            } else {
                me.advancedColumn1.unshift(widget);
            }
        };

        const qemuImgStorageTypes = ['dir', 'btrfs', 'nfs', 'cifs'];

        if (qemuImgStorageTypes.includes(me.type)) {
            addAdvancedWidget({
                xtype: 'pvePreallocationSelector',
                name: 'preallocation',
                fieldLabel: gettext('Preallocation'),
                allowBlank: false,
                deleteEmpty: !me.isCreate,
                value: '__default__',
            });
        }

        const externalStorageManagedSnapshotSupport = ['dir', 'nfs', 'cifs', 'lvm'];

        if (externalStorageManagedSnapshotSupport.includes(me.type)) {
            addAdvancedWidget({
                xtype: 'proxmoxcheckbox',
                name: 'snapshot-as-volume-chain',
                boxLabel: gettext('Allow Snapshots as Volume-Chain'),
                deleteEmpty: !me.isCreate,
                // can only allow to enable this on creation for storages that previously already
                // supported qcow2 to avoid ambiguity with existing volumes.
                disabled: !me.isCreate && me.type !== 'lvm',
                checked: false,
            });

            me.advancedColumnB = me.advancedColumnB || [];
            if (me.type === 'lvm') {
                me.advancedColumnB.unshift({
                    xtype: 'displayfield',
                    name: 'external-snapshot-hint-lvm',
                    userCls: 'pmx-hint',
                    value: gettext('Keep Snapshots as Volume-Chain enabled if qcow2 images exist!'),
                });
            }
            me.advancedColumnB.unshift({
                xtype: 'displayfield',
                name: 'external-snapshot-hint',
                userCls: 'pmx-hint',
                value: gettext('Snapshots as Volume-Chain are a technology preview.'),
            });
        }

        me.callParent();
    },
});

Ext.define('PVE.storage.BaseEdit', {
    extend: 'Proxmox.window.Edit',

    apiCallDone: function (success, response, options) {
        let me = this;
        if (typeof me.ipanel.apiCallDone === 'function') {
            me.ipanel.apiCallDone(success, response, options);
        }
    },

    initComponent: function () {
        let me = this;

        me.isCreate = !me.storageId;

        if (me.isCreate) {
            me.url = '/api2/extjs/storage';
            me.method = 'POST';
        } else {
            me.url = '/api2/extjs/storage/' + me.storageId;
            me.method = 'PUT';
        }

        me.ipanel = Ext.create(me.paneltype, {
            title: gettext('General'),
            type: me.type,
            isCreate: me.isCreate,
            storageId: me.storageId,
        });

        Ext.apply(me, {
            subject: PVE.Utils.format_storage_type(me.type),
            isAdd: true,
            bodyPadding: 0,
            items: {
                xtype: 'tabpanel',
                region: 'center',
                layout: 'fit',
                bodyPadding: 10,
                items: [
                    me.ipanel,
                    {
                        xtype: 'pveBackupJobPrunePanel',
                        title: gettext('Backup Retention'),
                        hasMaxProtected: true,
                        isCreate: me.isCreate,
                        keepAllDefaultForCreate: true,
                        showPBSHint: me.ipanel.isPBS,
                        fallbackHintHtml: gettext(
                            "Without any keep option, the node's vzdump.conf or `keep-all` is used as fallback for backup jobs",
                        ),
                    },
                ],
            },
        });

        if (me.ipanel.extraTabs) {
            me.ipanel.extraTabs.forEach((panel) => {
                panel.isCreate = me.isCreate;
                me.items.items.push(panel);
            });
        }

        me.callParent();

        if (!me.canDoBackups) {
            // cannot mask now, not fully rendered until activated
            me.down('pmxPruneInputPanel').needMask = true;
        }

        if (!me.isCreate) {
            me.load({
                success: function (response, options) {
                    let values = response.result.data;
                    let ctypes = values.content || '';

                    values.content = ctypes.split(',');

                    if (values.nodes) {
                        values.nodes = values.nodes.split(',');
                    }
                    values.enable = values.disable ? 0 : 1;
                    if (values['prune-backups']) {
                        let retention = PVE.Parser.parsePropertyString(values['prune-backups']);
                        delete values['prune-backups'];
                        Object.assign(values, retention);
                    }

                    me.query('inputpanel').forEach((panel) => {
                        panel.setValues(values);
                    });
                },
            });
        }
    },
});
