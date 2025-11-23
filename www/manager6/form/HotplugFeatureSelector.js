Ext.define('PVE.form.HotplugFeatureSelector', {
    extend: 'Ext.form.CheckboxGroup',
    alias: 'widget.pveHotplugFeatureSelector',

    columns: 1,
    vertical: true,

    defaults: {
        name: 'hotplugCbGroup',
        submitValue: false,
    },
    items: [
        {
            boxLabel: gettext('Disk'),
            inputValue: 'disk',
            checked: true,
        },
        {
            boxLabel: gettext('Network'),
            inputValue: 'network',
            checked: true,
        },
        {
            boxLabel: 'USB',
            inputValue: 'usb',
            checked: true,
        },
        {
            boxLabel: gettext('Memory'),
            inputValue: 'memory',
        },
        {
            boxLabel: gettext('CPU'),
            inputValue: 'cpu',
        },
    ],

    setValue: function (value) {
        var me = this;
        var newVal = [];
        if (value === '1') {
            newVal = ['disk', 'network', 'usb'];
        } else if (value !== '0') {
            newVal = value.split(',');
        }
        me.callParent([{ hotplugCbGroup: newVal }]);
    },

    // override framework function to
    // assemble the hotplug value
    getSubmitData: function () {
        var me = this,
            boxes = me.getBoxes(),
            data = [];
        Ext.Array.forEach(boxes, function (box) {
            if (box.getValue()) {
                data.push(box.inputValue);
            }
        });

        /* because above is hotplug an array */
        if (data.length === 0) {
            return { hotplug: '0' };
        } else {
            return { hotplug: data.join(',') };
        }
    },
});
