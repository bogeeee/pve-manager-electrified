Ext.define('pve-resource-pci-tree', {
    extend: 'Ext.data.Model',
    idProperty: 'internalId',
    fields: ['type', 'text', 'path', 'id', 'subsystem-id', 'iommugroup', 'description', 'digest'],
});

Ext.define('PVE.dc.PCIMapView', {
    extend: 'PVE.tree.ResourceMapTree',
    alias: 'widget.pveDcPCIMapView',

    editWindowClass: 'PVE.window.PCIMapEditWindow',
    baseUrl: '/cluster/mapping/pci',
    mapIconCls: 'pve-itype-icon-pci',
    getStatusCheckUrl: (node) => `/nodes/${node}/hardware/pci?pci-class-blacklist=`,
    entryIdProperty: 'path',

    checkValidity: function (data, node) {
        let me = this;
        let ids = {};
        data.forEach((entry) => {
            ids[entry.id] = entry;
        });
        // extract the mdev property from the global entry and insert to the individiual entries,
        // so we can reuse the normal checking logic
        let mdev;
        me.getRootNode()?.cascade(function (rec) {
            if (rec.data.type === 'entry') {
                mdev = rec.data.mdev ?? 0;
            }
            if (rec.data.node !== node || rec.data.type !== 'map') {
                return;
            }
            rec.data.mdev = mdev;

            let id = rec.data.path;
            if (!id.match(/\.\d$/)) {
                id += '.0';
            }
            let device = ids[id];
            if (!device) {
                rec.set('valid', 0);
                rec.set('errmsg', Ext.String.format(gettext('Cannot find PCI id {0}'), id));
                rec.commit();
                return;
            }

            let deviceId = `${device.vendor}:${device.device}`.replace(/0x/g, '');
            let subId = `${device.subsystem_vendor}:${device.subsystem_device}`.replace(/0x/g, '');

            let toCheck = {
                id: deviceId,
                'subsystem-id': subId,
                mdev: device.mdev ?? 0,
                iommugroup: device.iommugroup !== -1 ? device.iommugroup : undefined,
            };

            let valid = 1;
            let errors = [];
            let errText = gettext("Configuration for {0} not correct ('{1}' != '{2}')");
            for (const [key, validValue] of Object.entries(toCheck)) {
                if (`${rec.data[key]}` !== `${validValue}`) {
                    errors.push(Ext.String.format(errText, key, rec.data[key] ?? '', validValue));
                    valid = 0;
                }
            }

            rec.set('valid', valid);
            rec.set('errmsg', errors.join('<br>'));
            rec.commit();
        });
    },

    store: {
        sorters: 'text',
        model: 'pve-resource-pci-tree',
        data: {},
    },

    columns: [
        {
            xtype: 'treecolumn',
            text: gettext('ID/Node/Path'),
            dataIndex: 'text',
            width: 200,
        },
        {
            text: gettext('Vendor/Device'),
            dataIndex: 'id',
        },
        {
            text: gettext('Subsystem Vendor/Device'),
            dataIndex: 'subsystem-id',
        },
        {
            text: gettext('IOMMU-Group'),
            dataIndex: 'iommugroup',
        },
        {
            header: gettext('Status'),
            dataIndex: 'valid',
            flex: 1,
            renderer: 'renderStatus',
        },
        {
            header: gettext('Comment'),
            dataIndex: 'description',
            renderer: function (value, _meta, record) {
                return Ext.String.htmlEncode(value ?? record.data.comment);
            },
            flex: 1,
        },
    ],
});
