Ext.define('PVE.storage.BackupView', {
    extend: 'PVE.storage.ContentView',

    onlineHelp: 'chapter_vzdump',

    alias: 'widget.pveStorageBackupView',

    showColumns: ['name', 'notes', 'protected', 'date', 'format', 'size'],

    initComponent: function () {
        let me = this;

        let nodename = (me.nodename = me.pveSelNode.data.node);
        if (!nodename) {
            throw 'no node name specified';
        }

        let storage = (me.storage = me.pveSelNode.data.storage);
        if (!storage) {
            throw 'no storage ID specified';
        }

        me.content = 'backup';

        let sm = (me.sm = Ext.create('Ext.selection.RowModel', {}));

        let pruneButton = Ext.create('Proxmox.button.Button', {
            text: gettext('Prune group'),
            disabled: true,
            selModel: sm,
            setBackupGroup: function (backup) {
                if (backup) {
                    let name = backup.text;
                    let vmid = backup.vmid;
                    let format = backup.format;

                    let vmtype;
                    if (name.startsWith('vzdump-lxc-') || format === 'pbs-ct') {
                        vmtype = 'lxc';
                    } else if (name.startsWith('vzdump-qemu-') || format === 'pbs-vm') {
                        vmtype = 'qemu';
                    }

                    if (vmid && vmtype) {
                        this.setText(gettext('Prune group') + ` ${vmtype}/${vmid}`);
                        this.vmid = vmid;
                        this.vmtype = vmtype;
                        this.setDisabled(false);
                        return;
                    }
                }
                this.setText(gettext('Prune group'));
                this.vmid = null;
                this.vmtype = null;
                this.setDisabled(true);
            },
            handler: function (b, e, rec) {
                Ext.create('PVE.window.Prune', {
                    autoShow: true,
                    nodename,
                    storage,
                    backup_id: this.vmid,
                    backup_type: this.vmtype,
                    listeners: {
                        destroy: () => me.store.load(),
                    },
                });
            },
        });

        me.on('selectionchange', function (model, srecords, eOpts) {
            if (srecords.length === 1) {
                pruneButton.setBackupGroup(srecords[0].data);
            } else {
                pruneButton.setBackupGroup(null);
            }
        });

        let isPBS = me.pluginType === 'pbs';

        me.tbar = [
            {
                xtype: 'proxmoxButton',
                text: gettext('Restore'),
                selModel: sm,
                disabled: true,
                handler: function (b, e, rec) {
                    let vmtype;
                    if (PVE.Utils.volume_is_qemu_backup(rec.data)) {
                        vmtype = 'qemu';
                    } else if (PVE.Utils.volume_is_lxc_backup(rec.data)) {
                        vmtype = 'lxc';
                    } else {
                        return;
                    }

                    Ext.create('PVE.window.Restore', {
                        autoShow: true,
                        nodename,
                        volid: rec.data.volid,
                        volidText: PVE.Utils.render_storage_content(rec.data.volid, {}, rec),
                        vmtype,
                        isPBS,
                        listeners: {
                            destroy: () => me.store.load(),
                        },
                    });
                },
            },
        ];
        if (isPBS) {
            me.tbar.push({
                xtype: 'proxmoxButton',
                text: gettext('File Restore'),
                disabled: true,
                selModel: sm,
                handler: function (b, e, rec) {
                    let isVMArchive = PVE.Utils.volume_is_qemu_backup(
                        rec.data.volid,
                        rec.data.format,
                    );
                    Ext.create('Proxmox.window.FileBrowser', {
                        title: gettext('File Restore') + ' - ' + rec.data.text,
                        listURL: `/api2/json/nodes/localhost/storage/${me.storage}/file-restore/list`,
                        downloadURL: `/api2/json/nodes/localhost/storage/${me.storage}/file-restore/download`,
                        extraParams: {
                            volume: rec.data.volid,
                        },
                        archive: isVMArchive ? 'all' : undefined,
                        autoShow: true,
                    });
                },
            });
        }
        me.tbar.push(
            {
                xtype: 'proxmoxButton',
                text: gettext('Show Configuration'),
                disabled: true,
                selModel: sm,
                handler: function (b, e, rec) {
                    Ext.create('PVE.window.BackupConfig', {
                        autoShow: true,
                        volume: rec.data.volid,
                        pveSelNode: me.pveSelNode,
                    });
                },
            },
            {
                xtype: 'proxmoxButton',
                text: gettext('Edit Notes'),
                disabled: true,
                selModel: sm,
                handler: function (b, e, rec) {
                    let volid = rec.data.volid;
                    Ext.create('Proxmox.window.Edit', {
                        autoShow: true,
                        autoLoad: true,
                        width: 600,
                        height: 400,
                        resizable: true,
                        title: gettext('Notes'),
                        url: `/api2/extjs/nodes/${nodename}/storage/${me.storage}/content/${volid}`,
                        layout: 'fit',
                        items: [
                            {
                                xtype: 'textarea',
                                layout: 'fit',
                                name: 'notes',
                                height: '100%',
                            },
                        ],
                        listeners: {
                            destroy: () => me.store.load(),
                        },
                    });
                },
            },
            {
                xtype: 'proxmoxButton',
                text: gettext('Change Protection'),
                disabled: true,
                handler: function (button, event, record) {
                    const volid = record.data.volid;
                    Proxmox.Utils.API2Request({
                        url: `/api2/extjs/nodes/${nodename}/storage/${me.storage}/content/${volid}`,
                        method: 'PUT',
                        waitMsgTarget: me,
                        params: { protected: record.data.protected ? 0 : 1 },
                        failure: (response) => Ext.Msg.alert('Error', response.htmlStatus),
                        success: () => {
                            me.store.load({
                                callback: () => sm.fireEvent('selectionchange', sm, [record]),
                            });
                        },
                    });
                },
            },
            '-',
            pruneButton,
        );

        me.extraColumns = {};

        if (isPBS) {
            me.extraColumns.encrypted = {
                header: gettext('Encrypted'),
                dataIndex: 'encrypted',
                renderer: PVE.Utils.render_backup_encryption,
                sorter: {
                    property: 'encrypted',
                    transform: (encrypted) => (encrypted ? 1 : 0),
                },
            };
            me.extraColumns.verification = {
                header: gettext('Verify State'),
                dataIndex: 'verification',
                renderer: PVE.Utils.render_backup_verification,
                sorter: {
                    property: 'verification',
                    transform: (value) => {
                        let state = value?.state ?? 'none';
                        let order = PVE.Utils.verificationStateOrder;
                        return order[state] ?? order.__default__;
                    },
                },
            };
        }

        me.extraColumns.vmid = {
            header: 'VMID',
            dataIndex: 'vmid',
            hidden: true,
            sorter: (a, b) => (a.data.vmid ?? 0) - (b.data.vmid ?? 0),
        };

        me.callParent();

        me.store.getSorters().clear();
        me.store.setSorters([
            {
                property: 'vdate',
                direction: 'DESC',
            },
        ]);
    },
});
