Ext.define('PVE.grid.BackupView', {
    extend: 'Ext.grid.GridPanel',

    alias: ['widget.pveBackupView'],

    onlineHelp: 'chapter_vzdump',

    stateful: true,
    stateId: 'grid-guest-backup',

    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        var vmid = me.pveSelNode.data.vmid;
        if (!vmid) {
            throw 'no VM ID specified';
        }

        var vmtype = me.pveSelNode.data.type;
        if (!vmtype) {
            throw 'no VM type specified';
        }

        var vmtypeFilter;
        if (vmtype === 'lxc' || vmtype === 'openvz') {
            vmtypeFilter = function (item) {
                return PVE.Utils.volume_is_lxc_backup(item.data);
            };
        } else if (vmtype === 'qemu') {
            vmtypeFilter = function (item) {
                return PVE.Utils.volume_is_qemu_backup(item.data);
            };
        } else {
            throw "unsupported VM type '" + vmtype + "'";
        }

        let vmname = me.pveSelNode.data.name;

        var searchFilter = {
            property: 'volid',
            value: '',
            anyMatch: true,
            caseSensitive: false,
        };

        var vmidFilter = {
            property: 'vmid',
            value: vmid,
            exactMatch: true,
        };

        me.store = Ext.create('Ext.data.Store', {
            model: 'pve-storage-content',
            sorters: [
                {
                    property: 'vmid',
                    direction: 'ASC',
                },
                {
                    property: 'vdate',
                    direction: 'DESC',
                },
            ],
            filters: [vmtypeFilter, searchFilter, vmidFilter],
        });

        let updateFilter = function () {
            me.store.filter([vmtypeFilter, searchFilter, vmidFilter]);
        };

        const reload = Ext.Function.createBuffered((options) => {
            if (me.store) {
                me.store.load(options);
            }
        }, 100);

        let isPBS = false;
        var setStorage = function (storage) {
            var url = '/api2/json/nodes/' + nodename + '/storage/' + storage + '/content';
            url += '?content=backup';

            me.store.setProxy({
                type: 'proxmox',
                url: url,
            });

            Proxmox.Utils.monStoreErrors(me.view, me.store, true);

            reload();
        };

        let file_restore_btn;

        var storagesel = Ext.create('PVE.form.StorageSelector', {
            nodename: nodename,
            fieldLabel: gettext('Storage'),
            labelAlign: 'right',
            storageContent: 'backup',
            allowBlank: false,
            listeners: {
                change: function (f, value) {
                    let storage = f.getStore().findRecord('storage', value, 0, false, true, true);
                    if (storage) {
                        isPBS = storage.data.type === 'pbs';
                        me.getColumns().forEach((column) => {
                            let id = column.dataIndex;
                            if (id === 'verification' || id === 'encrypted') {
                                column.setHidden(!isPBS);
                            }
                        });
                    } else {
                        isPBS = false;
                    }
                    setStorage(value);
                    if (file_restore_btn) {
                        file_restore_btn.setHidden(!isPBS);
                    }
                },
            },
        });

        var storagefilter = Ext.create('Ext.form.field.Text', {
            fieldLabel: gettext('Search'),
            labelWidth: 50,
            labelAlign: 'right',
            enableKeyEvents: true,
            value: searchFilter.value,
            listeners: {
                buffer: 500,
                keyup: function (field) {
                    me.store.clearFilter(true);
                    searchFilter.value = field.getValue();
                    updateFilter();
                },
            },
        });

        var vmidfilterCB = Ext.create('Ext.form.field.Checkbox', {
            boxLabel: gettext('Filter VMID'),
            value: '1',
            listeners: {
                change: function (cb, value) {
                    vmidFilter.value = value ? vmid : '';
                    vmidFilter.exactMatch = !!value;
                    updateFilter();
                },
            },
        });

        var sm = Ext.create('Ext.selection.RowModel', {});

        var backup_btn = Ext.create('Ext.button.Button', {
            text: gettext('Backup now'),
            handler: function () {
                var win = Ext.create('PVE.window.Backup', {
                    nodename: nodename,
                    vmid: vmid,
                    vmtype: vmtype,
                    vmname: vmname,
                    storage: storagesel.getValue(),
                    listeners: {
                        close: function () {
                            reload();
                        },
                    },
                });
                win.show();
            },
        });

        var restore_btn = Ext.create('Proxmox.button.Button', {
            text: gettext('Restore'),
            disabled: true,
            selModel: sm,
            enableFn: function (rec) {
                return !!rec;
            },
            handler: function (b, e, rec) {
                let win = Ext.create('PVE.window.Restore', {
                    nodename: nodename,
                    vmid: vmid,
                    vmname: vmname,
                    volid: rec.data.volid,
                    volidText: PVE.Utils.render_storage_content(rec.data.volid, {}, rec),
                    vmtype: vmtype,
                    isPBS: isPBS,
                });
                win.show();
                win.on('destroy', reload);
            },
        });

        let delete_btn = Ext.create('Proxmox.button.StdRemoveButton', {
            selModel: sm,
            dangerous: true,
            delay: 5,
            enableFn: (rec) => !rec?.data?.protected,
            confirmMsg: ({ data }) => {
                let msg = Ext.String.format(
                    gettext('Are you sure you want to remove entry {0}'),
                    `'${data.volid}'`,
                );
                return msg + ' ' + gettext('This will permanently erase all data.');
            },
            getUrl: ({ data }) =>
                `/nodes/${nodename}/storage/${storagesel.getValue()}/content/${data.volid}`,
            callback: () => reload(),
        });

        let config_btn = Ext.create('Proxmox.button.Button', {
            text: gettext('Show Configuration'),
            disabled: true,
            selModel: sm,
            enableFn: (rec) => !!rec,
            handler: function (b, e, rec) {
                let storage = storagesel.getValue();
                if (!storage) {
                    return;
                }
                Ext.create('PVE.window.BackupConfig', {
                    volume: rec.data.volid,
                    pveSelNode: me.pveSelNode,
                    autoShow: true,
                });
            },
        });

        // declared above so that the storage selector can change this buttons hidden state
        file_restore_btn = Ext.create('Proxmox.button.Button', {
            text: gettext('File Restore'),
            disabled: true,
            selModel: sm,
            enableFn: (rec) => !!rec && isPBS,
            hidden: !isPBS,
            handler: function (b, e, rec) {
                let storage = storagesel.getValue();
                let isVMArchive = PVE.Utils.volume_is_qemu_backup(rec.data.volid, rec.data.format);
                Ext.create('Proxmox.window.FileBrowser', {
                    title: gettext('File Restore') + ' - ' + rec.data.text,
                    listURL: `/api2/json/nodes/localhost/storage/${storage}/file-restore/list`,
                    downloadURL: `/api2/json/nodes/localhost/storage/${storage}/file-restore/download`,
                    extraParams: {
                        volume: rec.data.volid,
                    },
                    archive: isVMArchive ? 'all' : undefined,
                    autoShow: true,
                });
            },
        });

        Ext.apply(me, {
            selModel: sm,
            tbar: {
                overflowHandler: 'scroller',
                items: [
                    backup_btn,
                    '-',
                    restore_btn,
                    file_restore_btn,
                    config_btn,
                    {
                        xtype: 'proxmoxButton',
                        text: gettext('Edit Notes'),
                        disabled: true,
                        handler: function () {
                            let volid = sm.getSelection()[0].data.volid;
                            var storage = storagesel.getValue();
                            Ext.create('Proxmox.window.Edit', {
                                autoLoad: true,
                                width: 600,
                                height: 400,
                                resizable: true,
                                title: gettext('Notes'),
                                url: `/api2/extjs/nodes/${nodename}/storage/${storage}/content/${volid}`,
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
                                    destroy: () => reload(),
                                },
                            }).show();
                        },
                    },
                    {
                        xtype: 'proxmoxButton',
                        text: gettext('Change Protection'),
                        disabled: true,
                        handler: function (button, event, record) {
                            let volid = record.data.volid,
                                storage = storagesel.getValue();
                            let url = `/api2/extjs/nodes/${nodename}/storage/${storage}/content/${volid}`;
                            Proxmox.Utils.API2Request({
                                url: url,
                                method: 'PUT',
                                waitMsgTarget: me,
                                params: {
                                    protected: record.data.protected ? 0 : 1,
                                },
                                failure: (response) => Ext.Msg.alert('Error', response.htmlStatus),
                                success: () => {
                                    reload({
                                        callback: () =>
                                            sm.fireEvent('selectionchange', sm, [record]),
                                    });
                                },
                            });
                        },
                    },
                    '-',
                    delete_btn,
                    '->',
                    storagesel,
                    '-',
                    vmidfilterCB,
                    storagefilter,
                ],
            },
            columns: [
                {
                    header: gettext('Name'),
                    flex: 2,
                    sortable: true,
                    renderer: PVE.Utils.render_storage_content,
                    dataIndex: 'volid',
                },
                {
                    header: gettext('Notes'),
                    dataIndex: 'notes',
                    flex: 1,
                    renderer: Ext.htmlEncode,
                },
                {
                    header: `<i class="fa fa-shield"></i>`,
                    tooltip: gettext('Protected'),
                    width: 30,
                    renderer: (v) =>
                        v ? `<i data-qtip="${gettext('Protected')}" class="fa fa-shield"></i>` : '',
                    sorter: (a, b) => (b.data.protected || 0) - (a.data.protected || 0),
                    dataIndex: 'protected',
                },
                {
                    header: gettext('Date'),
                    width: 150,
                    dataIndex: 'vdate',
                },
                {
                    header: gettext('Format'),
                    width: 100,
                    dataIndex: 'format',
                },
                {
                    header: gettext('Size'),
                    width: 100,
                    renderer: Proxmox.Utils.format_size,
                    dataIndex: 'size',
                },
                {
                    header: 'VMID',
                    dataIndex: 'vmid',
                    hidden: true,
                },
                {
                    header: gettext('Encrypted'),
                    dataIndex: 'encrypted',
                    renderer: PVE.Utils.render_backup_encryption,
                },
                {
                    // TRANSLATORS: The state of the verification task
                    header: gettext('Verify State'),
                    dataIndex: 'verification',
                    renderer: PVE.Utils.render_backup_verification,
                },
            ],
        });

        me.callParent();
    },
});
