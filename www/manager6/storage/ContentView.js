Ext.define(
    'PVE.storage.ContentView',
    {
        extend: 'Ext.grid.GridPanel',

        alias: 'widget.pveStorageContentView',

        itemdblclick: Ext.emptyFn,

        viewConfig: {
            trackOver: false,
            loadMask: false,
        },
        initComponent: function () {
            var me = this;

            if (!me.nodename) {
                me.nodename = me.pveSelNode.data.node;
                if (!me.nodename) {
                    throw 'no node name specified';
                }
            }
            const nodename = me.nodename;

            if (!me.storage) {
                me.storage = me.pveSelNode.data.storage;
                if (!me.storage) {
                    throw 'no storage ID specified';
                }
            }
            const storage = me.storage;

            var content = me.content;
            if (!content) {
                throw 'no content type specified';
            }

            const baseurl = `/nodes/${nodename}/storage/${storage}/content`;
            let store = (me.store = Ext.create('Ext.data.Store', {
                model: 'pve-storage-content',
                proxy: {
                    type: 'proxmox',
                    url: '/api2/json' + baseurl,
                    extraParams: {
                        content: content,
                    },
                },
                sorters: [
                    (a, b) =>
                        a.data.text
                            .toString()
                            .localeCompare(b.data.text.toString(), undefined, { numeric: true }),
                ],
            }));

            if (!me.sm) {
                me.sm = Ext.create('Ext.selection.RowModel', {});
            }
            let sm = me.sm;

            let reload = () => store.load();

            Proxmox.Utils.monStoreErrors(me, store);

            let tbar = me.tbar ? [...me.tbar] : [];
            if (me.useUploadButton) {
                tbar.unshift(
                    {
                        xtype: 'button',
                        text: gettext('Upload'),
                        disabled: !me.enableUploadButton,
                        handler: function () {
                            Ext.create('PVE.window.UploadToStorage', {
                                nodename: nodename,
                                storage: storage,
                                content: content,
                                autoShow: true,
                                taskDone: () => reload(),
                            });
                        },
                    },
                    {
                        xtype: 'button',
                        text: gettext('Download from URL'),
                        disabled: !me.enableDownloadUrlButton,
                        handler: function () {
                            Ext.create('PVE.window.DownloadUrlToStorage', {
                                nodename: nodename,
                                storage: storage,
                                content: content,
                                autoShow: true,
                                taskDone: () => reload(),
                            });
                        },
                    },
                    '-',
                );
            }
            if (!me.useCustomRemoveButton) {
                tbar.push({
                    xtype: 'proxmoxStdRemoveButton',
                    selModel: sm,
                    enableFn: (rec) => !rec?.data?.protected,
                    delay: 5,
                    callback: () => reload(),
                    baseurl: baseurl + '/',
                });
            }
            tbar.push('->', gettext('Search') + ':', ' ', {
                xtype: 'textfield',
                width: 200,
                enableKeyEvents: true,
                emptyText:
                    content === 'backup' ? gettext('Name, Format, Notes') : gettext('Name, Format'),
                listeners: {
                    keyup: {
                        buffer: 500,
                        fn: function (field) {
                            let needle = field.getValue().toLocaleLowerCase();
                            store.clearFilter(true);
                            store.filter([
                                {
                                    filterFn: ({ data }) =>
                                        data.text?.toLocaleLowerCase().includes(needle) ||
                                        data.notes?.toLocaleLowerCase().includes(needle),
                                },
                            ]);
                        },
                    },
                    change: function (field, newValue, oldValue) {
                        if (newValue !== this.originalValue) {
                            this.triggers.clear.setVisible(true);
                        }
                    },
                },
                triggers: {
                    clear: {
                        cls: 'pmx-clear-trigger',
                        weight: -1,
                        hidden: true,
                        handler: function () {
                            this.triggers.clear.setVisible(false);
                            this.setValue(this.originalValue);
                            store.clearFilter();
                        },
                    },
                },
            });

            let availableColumns = {
                name: {
                    header: gettext('Name'),
                    flex: 2,
                    sortable: true,
                    renderer: PVE.Utils.render_storage_content,
                    sorter: (a, b) =>
                        a.data.text
                            .toString()
                            .localeCompare(b.data.text.toString(), undefined, { numeric: true }),
                    dataIndex: 'text',
                },
                notes: {
                    header: gettext('Notes'),
                    flex: 1,
                    renderer: Ext.htmlEncode,
                    dataIndex: 'notes',
                },
                protected: {
                    header: `<i class="fa fa-shield"></i>`,
                    tooltip: gettext('Protected'),
                    width: 30,
                    renderer: (v) =>
                        v ? `<i data-qtip="${gettext('Protected')}" class="fa fa-shield"></i>` : '',
                    sorter: (a, b) => (b.data.protected || 0) - (a.data.protected || 0),
                    dataIndex: 'protected',
                },
                date: {
                    header: gettext('Date'),
                    width: 150,
                    dataIndex: 'vdate',
                },
                format: {
                    header: gettext('Format'),
                    width: 100,
                    dataIndex: 'format',
                },
                size: {
                    header: gettext('Size'),
                    width: 100,
                    renderer: Proxmox.Utils.format_size,
                    dataIndex: 'size',
                },
            };

            let showColumns = me.showColumns || ['name', 'date', 'format', 'size'];

            Object.keys(availableColumns).forEach(function (key) {
                if (!showColumns.includes(key)) {
                    delete availableColumns[key];
                }
            });

            if (me.extraColumns && typeof me.extraColumns === 'object') {
                Object.assign(availableColumns, me.extraColumns);
            }
            const columns = Object.values(availableColumns);

            Ext.apply(me, {
                store,
                selModel: sm,
                tbar,
                columns,
                listeners: {
                    activate: reload,
                    itemdblclick: (view, record) => me.itemdblclick(view, record),
                },
            });

            me.callParent();
        },
    },
    function () {
        Ext.define('pve-storage-content', {
            extend: 'Ext.data.Model',
            fields: [
                'volid',
                'content',
                'format',
                'size',
                'used',
                'vmid',
                'channel',
                'id',
                'lun',
                'notes',
                'verification',
                {
                    name: 'text',
                    convert: function (value, record) {
                        // check for volid, because if you click on a grouping header,
                        // it calls convert (but with an empty volid)
                        if (value || record.data.volid === null) {
                            return value;
                        }
                        return PVE.Utils.render_storage_content(value, {}, record);
                    },
                },
                {
                    name: 'vdate',
                    convert: function (value, record) {
                        // check for volid, because if you click on a grouping header,
                        // it calls convert (but with an empty volid)
                        if (value || record.data.volid === null) {
                            return value;
                        }
                        let t = record.data.content;
                        if (t === 'backup') {
                            let v = record.data.volid;
                            let match = v.match(/(\d{4}_\d{2}_\d{2})-(\d{2}_\d{2}_\d{2})/);
                            if (match) {
                                let date = match[1].replace(/_/g, '-');
                                let time = match[2].replace(/_/g, ':');
                                return date + ' ' + time;
                            }
                        }
                        if (record.data.ctime) {
                            let ctime = new Date(record.data.ctime * 1000);
                            return Ext.Date.format(ctime, 'Y-m-d H:i:s');
                        }
                        return '';
                    },
                },
            ],
            idProperty: 'volid',
        });
    },
);
