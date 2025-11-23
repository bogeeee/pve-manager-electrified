Ext.define('PVE.form.MemoryField', {
    extend: 'Ext.form.field.Number',
    alias: 'widget.pveMemoryField',

    allowBlank: false,

    hotplug: false,

    minValue: 32,

    maxValue: 4178944,

    step: 32,

    value: '512', // qm backend default

    allowDecimals: false,

    allowExponential: false,

    computeUpDown: function (value) {
        var me = this;

        if (!me.hotplug) {
            return { up: value + me.step, down: value - me.step };
        }

        var dimm_size = 512;
        var prev_dimm_size = 0;
        var min_size = 1024;
        var current_size = min_size;
        var value_up = min_size;
        var value_down = min_size;
        var value_start = min_size;

        var i, j;
        for (j = 0; j < 9; j++) {
            for (i = 0; i < 32; i++) {
                if (value >= current_size && value < current_size + dimm_size) {
                    value_start = current_size;
                    value_up = current_size + dimm_size;
                    value_down = current_size - (i === 0 ? prev_dimm_size : dimm_size);
                }
                current_size += dimm_size;
            }
            prev_dimm_size = dimm_size;
            dimm_size = dimm_size * 2;
        }

        return { up: value_up, down: value_down, start: value_start };
    },

    onSpinUp: function () {
        var me = this;
        if (!me.readOnly) {
            let res = me.computeUpDown(me.getValue());
            me.setValue(Ext.Number.constrain(res.up, me.minValue, me.maxValue));
        }
    },

    onSpinDown: function () {
        var me = this;
        if (!me.readOnly) {
            let res = me.computeUpDown(me.getValue());
            me.setValue(Ext.Number.constrain(res.down, me.minValue, me.maxValue));
        }
    },

    initComponent: function () {
        var me = this;

        if (me.hotplug) {
            me.minValue = 1024;

            me.on('blur', function (field) {
                var value = me.getValue();
                var res = me.computeUpDown(value);
                if (value === res.start || value === res.up || value === res.down) {
                    return;
                }
                field.setValue(res.up);
            });
        }

        me.callParent();
    },
});
