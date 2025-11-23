Ext.define('pve-resource-usb-tree', {
    extend: 'Ext.data.Model',
    idProperty: 'internalId',
    fields: ['type', 'text', 'path', 'id', 'description', 'digest'],
});

Ext.define('PVE.dc.USBMapView', {
    extend: 'PVE.tree.ResourceMapTree',
    alias: 'widget.pveDcUSBMapView',

    editWindowClass: 'PVE.window.USBMapEditWindow',
    baseUrl: '/cluster/mapping/usb',
    mapIconCls: 'fa fa-usb',
    getStatusCheckUrl: (node) => `/nodes/${node}/hardware/usb`,
    entryIdProperty: 'id',

    checkValidity: function (data, node) {
        let me = this;
        let ids = {};
        let paths = {};
        data.forEach((entry) => {
            ids[`${entry.vendid}:${entry.prodid}`] = entry;
            paths[`${entry.busnum}-${entry.usbpath}`] = entry;
        });
        me.getRootNode()?.cascade(function (rec) {
            if (rec.data.node !== node || rec.data.type !== 'map') {
                return;
            }

            let device;
            if (rec.data.path) {
                device = paths[rec.data.path];
            }
            device ??= ids[rec.data.id];

            if (!device) {
                rec.set('valid', 0);
                rec.set(
                    'errmsg',
                    Ext.String.format(gettext('Cannot find USB device {0}'), rec.data.id),
                );
                rec.commit();
                return;
            }

            let deviceId = `${device.vendid}:${device.prodid}`.replace(/0x/g, '');

            let toCheck = {
                id: deviceId,
            };

            let valid = 1;
            let errors = [];
            let errText = gettext("Configuration for {0} not correct ('{1}' != '{2}')");
            for (const [key, validValue] of Object.entries(toCheck)) {
                if (rec.data[key] !== validValue) {
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
        model: 'pve-resource-usb-tree',
        data: {},
    },

    columns: [
        {
            xtype: 'treecolumn',
            text: gettext('ID/Node/Vendor&Device'),
            dataIndex: 'text',
            width: 200,
        },
        {
            text: gettext('Path'),
            dataIndex: 'path',
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
